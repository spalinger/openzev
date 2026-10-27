"""SQL annual energy aggregation matching the dashboard's per-reading rules.

Readings are netted per timestamp and attributed by civil-day assignments.
``metering.analytics`` remains the reference; differential tests compare them.
"""

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db import connection
from django.db.models import Q

from allocation.errors import InvalidAllocationInputError
from allocation.validity import business_tz, period_end_exclusive_dt, period_start_dt
from allocation.windows import AssignmentWindows
from zev.models import MeteringPointAssignment

from .models import MeterReading

_SHARED_SQL = """
-- 'in'/'out' and 'personal'/'community' are persisted TextChoices values.
WITH zmp AS (
    SELECT id, has_behind_meter_generation
    FROM zev_meteringpoint
    WHERE zev_id = %s
),
physical AS (
    SELECT mr.timestamp AS ts,
           SUM(CASE WHEN mr.direction = 'in' THEN mr.energy_kwh ELSE 0 END) AS consumed,
           SUM(CASE WHEN mr.direction = 'out' THEN mr.energy_kwh ELSE 0 END) AS produced,
           MIN(mr.energy_kwh) AS min_reading,
           MAX(CASE WHEN zmp.has_behind_meter_generation THEN 1 ELSE 0 END) AS flagged
    FROM metering_meterreading mr
    JOIN zmp ON zmp.id = mr.metering_point_id
    WHERE mr.timestamp >= %s AND mr.timestamp < %s
    GROUP BY mr.timestamp
),
monthly AS (
    SELECT {month_sql} AS month,
           SUM(consumed) AS consumed,
           SUM(produced) AS produced,
           SUM(CASE WHEN consumed > produced THEN consumed - produced ELSE 0 END) AS imported,
           SUM(CASE WHEN produced > consumed THEN produced - consumed ELSE 0 END) AS exported,
           MIN(min_reading) AS min_reading,
           MAX(flagged) AS flagged
    FROM physical
    GROUP BY 1
)
"""

_MONTH_TAIL = """
SELECT 'month' AS kind, month, NULL AS participant_id,
       consumed, produced, imported, exported, NULL AS from_zev, flagged, min_reading
FROM monthly
"""

_PARTICIPANT_TAIL = """,
-- One row per (metering point, civil day, direction): the assignment and the
-- community shares are day-granular, so the year's readings collapse before
-- they are attributed. ``from_zev`` keeps the per-timestamp pool: it is
-- summed here against each reading's own timestamp, not against a day total.
weighted AS (
    SELECT mr.metering_point_id AS mp_id,
           {day_sql} AS day,
           mr.direction AS direction,
           SUM(mr.energy_kwh) AS energy,
           -- 1.0 keeps SQLite from truncating the fractional local share.
           SUM(CASE WHEN mr.direction = 'in' AND p.consumed > 0
                    THEN 1.0 * mr.energy_kwh
                         * (CASE WHEN p.produced < p.consumed THEN p.produced ELSE p.consumed END)
                         / p.consumed
                    ELSE 0 END) AS from_zev
    FROM metering_meterreading mr
    JOIN physical p ON p.ts = mr.timestamp
    WHERE mr.metering_point_id IN (SELECT id FROM zmp)
      AND mr.timestamp >= %s AND mr.timestamp < %s
    GROUP BY mr.metering_point_id, day, mr.direction
),
assigned AS (
    SELECT w.direction, w.day, w.energy, w.from_zev,
           a.participant_id, a.allocation_mode,
           CASE WHEN zmp.has_behind_meter_generation
                     AND a.allocation_mode = 'personal'
                THEN 1 ELSE 0 END AS flagged
    FROM weighted w
    JOIN zmp ON zmp.id = w.mp_id
    LEFT JOIN zev_meteringpointassignment a
        ON a.metering_point_id = w.mp_id
       AND a.valid_from <= w.day
       AND (a.valid_to IS NULL OR a.valid_to >= w.day)
),
personal_totals AS (
    SELECT participant_id, direction,
           SUM(energy) AS energy, SUM(from_zev) AS from_zev, MAX(flagged) AS flagged
    FROM assigned
    WHERE allocation_mode = 'personal'
    GROUP BY participant_id, direction
),
community_days AS (
    SELECT day, direction, SUM(energy) AS energy, SUM(from_zev) AS from_zev
    FROM assigned
    WHERE allocation_mode = 'community'
    GROUP BY day, direction
),
-- Keep PostgreSQL from rescanning the window calculation per community day.
shares AS {materialized}(
    SELECT cd.day, pa.id AS participant_id,
           -- Participant.allocation_weight is validated >= 0.0001, so the
           -- divisor is positive for valid data.
           1.0 * pa.allocation_weight
               / SUM(pa.allocation_weight) OVER (PARTITION BY cd.day) AS share
    FROM (SELECT DISTINCT day FROM community_days) cd
    JOIN zev_participant pa
        ON pa.zev_id = %s
       AND pa.valid_from <= cd.day
       AND (pa.valid_to IS NULL OR pa.valid_to >= cd.day)
),
community_totals AS (
    SELECT sh.participant_id, cd.direction,
           SUM(cd.energy * sh.share) AS energy,
           SUM(cd.from_zev * sh.share) AS from_zev,
           0 AS flagged
    FROM community_days cd
    JOIN shares sh ON sh.day = cd.day
    GROUP BY sh.participant_id, cd.direction
),
totals AS (
    SELECT participant_id, direction, energy, from_zev, flagged FROM personal_totals
    UNION ALL
    SELECT participant_id, direction, energy, from_zev, flagged FROM community_totals
),
participant_totals AS (
    SELECT participant_id,
           SUM(CASE WHEN direction = 'in' THEN energy ELSE 0 END) AS consumed,
           SUM(CASE WHEN direction = 'in' THEN from_zev ELSE 0 END) AS from_zev,
           SUM(CASE WHEN direction = 'out' THEN energy ELSE 0 END) AS produced,
           MAX(flagged) AS flagged
    FROM totals
    GROUP BY participant_id
)
SELECT 'month' AS kind, m.month, NULL AS participant_id,
       m.consumed, m.produced, m.imported, m.exported, NULL AS from_zev, m.flagged, m.min_reading
FROM monthly m
UNION ALL
SELECT 'participant', NULL, CAST(p.participant_id AS TEXT),
       p.consumed, p.produced, 0, 0, p.from_zev, p.flagged, NULL
FROM participant_totals p
"""

_MONTHLY_ONLY_SQL = _SHARED_SQL + _MONTH_TAIL
_WITH_PARTICIPANTS_SQL = _SHARED_SQL + _PARTICIPANT_TAIL


@dataclass(frozen=True)
class ParticipantEnergy:
    """Annual participant energy totals."""

    consumed_kwh: float
    produced_kwh: float
    from_zev_kwh: float
    from_grid_kwh: float
    has_behind_meter_generation: bool


@dataclass(frozen=True)
class YearEnergy:
    """The ZEV's year, plus participant attribution when requested."""

    months: dict[int, dict[str, float]]
    totals: dict[str, float]
    has_behind_meter_generation: bool
    participants: dict[str, ParticipantEnergy]

    @property
    def has_data(self) -> bool:
        return bool(self.months)


def _uuid_param(value):
    """A UUID as the active backend stores it (native on PostgreSQL, hex on SQLite)."""
    if connection.features.has_native_uuid_field:
        return value
    return value.hex


def year_energy(zev, year: int, *, with_participants: bool = False) -> YearEnergy:
    """Aggregate a civil year's balance, optionally including participant attribution."""
    tz = str(business_tz())
    month_sql, month_params = connection.ops.datetime_extract_sql("month", "ts", [], tz)
    start = connection.ops.adapt_datetimefield_value(period_start_dt(date(year, 1, 1)))
    end = connection.ops.adapt_datetimefield_value(period_end_exclusive_dt(date(year, 12, 31)))
    zev_id = _uuid_param(zev.pk)

    if with_participants:
        _ensure_assignments_do_not_overlap(zev, year)
        day_sql, day_params = connection.ops.datetime_cast_date_sql(
            "mr.timestamp", [], tz,
        )
        sql = _WITH_PARTICIPANTS_SQL.format(
            month_sql=month_sql, day_sql=day_sql,
            materialized="MATERIALIZED " if connection.vendor == "postgresql" else "",
        )
        # Placeholder order: zmp.zev_id, physical start/end, monthly tz,
        # weighted day tz, weighted start/end, shares zev_id.
        params = [zev_id, start, end, *month_params, *day_params, start, end, zev_id]
    else:
        sql = _MONTHLY_ONLY_SQL.format(month_sql=month_sql)
        params = [zev_id, start, end, *month_params]

    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        rows = cursor.fetchall()

    months: dict[int, dict[str, float]] = {}
    # Sum database values before converting totals to floats.
    sums = {
        "produced_kwh": Decimal("0"),
        "consumed_kwh": Decimal("0"),
        "imported_kwh": Decimal("0"),
        "exported_kwh": Decimal("0"),
    }
    participants: dict[str, ParticipantEnergy] = {}
    has_behind_meter_generation = False

    for kind, month, participant_id, consumed, produced, imported, exported, from_zev, flagged, min_reading in rows:
        if kind == "month":
            if min_reading < 0:
                raise InvalidAllocationInputError(f"energy_kwh must be non-negative, got {min_reading}")
            months[int(month)] = {
                "produced_kwh": float(produced),
                "consumed_kwh": float(consumed),
                "imported_kwh": float(imported),
                "exported_kwh": float(exported),
            }
            sums["produced_kwh"] += Decimal(str(produced))
            sums["consumed_kwh"] += Decimal(str(consumed))
            sums["imported_kwh"] += Decimal(str(imported))
            sums["exported_kwh"] += Decimal(str(exported))
            has_behind_meter_generation = has_behind_meter_generation or bool(flagged)
        else:
            pid = str(uuid.UUID(str(participant_id)))
            consumed_f = float(consumed)
            from_zev_f = float(from_zev)
            participants[pid] = ParticipantEnergy(
                consumed_kwh=consumed_f,
                produced_kwh=float(produced),
                from_zev_kwh=from_zev_f,
                from_grid_kwh=consumed_f - from_zev_f,
                has_behind_meter_generation=bool(flagged),
            )

    return YearEnergy(
        months=months,
        totals={key: float(value) for key, value in sums.items()},
        has_behind_meter_generation=has_behind_meter_generation,
        participants=participants,
    )


def _ensure_assignments_do_not_overlap(zev, year: int) -> None:
    """Reject overlapping assignment windows before the SQL join double-counts readings."""
    start = date(year, 1, 1)
    end = date(year, 12, 31)
    reading_mps = (
        MeterReading.objects.filter(
            metering_point__zev=zev,
            timestamp__gte=period_start_dt(start),
            timestamp__lt=period_end_exclusive_dt(end),
        )
        .values_list("metering_point_id", flat=True)
        .distinct()
    )
    rows = (
        MeteringPointAssignment.objects.filter(
            metering_point_id__in=reading_mps,
            valid_from__lte=end,
        )
        .filter(Q(valid_to__isnull=True) | Q(valid_to__gte=start))
        .values_list(
            "metering_point_id", "valid_from", "valid_to", "participant_id",
            "allocation_mode", "id",
        )
    )
    AssignmentWindows(rows)
