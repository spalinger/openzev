"""
Pure analytics functions extracted from MeterReadingViewSet.

These functions receive pre-filtered querysets / parameters and return plain
dicts that views can hand straight to Response().  No HTTP or permission logic
lives here, which makes the calculations independently unit-testable.
"""
from collections import defaultdict
from datetime import date as date_type, datetime, timedelta, timezone as dt_timezone
from decimal import Decimal, ROUND_HALF_UP
from itertools import groupby

from django.db.models import Count, Max, Min, Q, Sum
from django.db.models.functions import TruncDate, TruncDay, TruncHour, TruncMonth
from django.utils.timezone import get_current_timezone

from allocation.errors import OverlappingAssignmentWindowsError
from allocation.read_model import (
    CONSUMPTION_METER_TYPES,
    community_totals_by_timestamp,
    eligible_participant_shares,
)
from allocation.validity import (
    active_during,
    business_tz,
    civil_date,
    period_end_exclusive_dt,
    period_window,
    wall_clock,
)
from allocation.split import split_consumption, split_production
from allocation.windows import AssignmentWindows
from zev import access
from zev.models import (
    AllocationMode,
    Participant,
    MeteringPoint,
    MeteringPointAssignment,
)
from .models import MeterReading


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _qs_bounds(qs, today: date_type) -> tuple[date_type, date_type]:
    """The civil-date window covered by a readings queryset.

    Assignment validity is date-granular in civil time, so the bounds must be
    civil dates too: ``timestamp.date()`` reads the UTC date, which is the
    previous day for every reading after local 22:00/23:00 and would drop the
    assignment holding a reading in that window.
    """
    bounds = qs.aggregate(first=Min("timestamp"), last=Max("timestamp"))
    start = civil_date(bounds["first"]) if bounds["first"] else today
    end = civil_date(bounds["last"]) if bounds["last"] else today
    return start, end


def _assignment_windows_for_readings(qs, start: date_type, end: date_type) -> AssignmentWindows:
    """AssignmentWindows for every metering point in ``qs``, overlapping ``start``..``end``.

    Readings are attributed to the participant whose assignment is active at
    the reading's timestamp (ADR 0013); period-level overlap would attribute
    pre-assignment readings to the current holder.
    """
    metering_point_ids = qs.values_list("metering_point_id", flat=True).distinct()
    rows = active_during(
        MeteringPointAssignment.objects.filter(metering_point_id__in=metering_point_ids),
        start,
        end,
    ).values_list(
        "metering_point_id", "valid_from", "valid_to", "participant_id",
        "allocation_mode", "id",
    )
    return AssignmentWindows(rows)


def _community_shares_by_zev(metering_point_ids, start: date_type, end: date_type) -> dict:
    """``eligible_participant_shares`` per ZEV touched by ``metering_point_ids``.

    A dashboard queryset can span more than one ZEV (a participant or an
    admin viewing several communities' meters at once), and share
    normalization is inherently per-ZEV — one extra query maps metering
    points to their ZEV, then one ``eligible_participant_shares`` call per
    distinct ZEV (almost always exactly one). Returns
    ``(mp_to_zev, shares_by_zev)``.
    """
    mp_to_zev = dict(
        MeteringPoint.objects.filter(id__in=metering_point_ids).values_list("id", "zev_id")
    )
    shares_by_zev = {
        zev_id: eligible_participant_shares(zev_id, start, end)
        for zev_id in set(mp_to_zev.values())
    }
    return mp_to_zev, shares_by_zev


def _distribute_reading(windows, mp_to_zev, shares_by_zev, metering_point_id, ts):
    """``(participant_id, share)`` pairs a reading at ``(mp, ts)`` attributes to.

    A personal assignment yields exactly one pair with ``share=1``; a
    community assignment yields one pair per eligible participant, weighted
    by ``allocation_weight``; a gap (no assignment covers ``ts``) yields
    nothing — matches ``assignment_at``'s contract of distinguishing a true
    gap from a community window rather than conflating both under ``None``.
    Assignments and eligible shares are constant within a civil day, so callers
    may reuse this distribution for the rest of that meter/day.
    """
    resolution = windows.assignment_at(metering_point_id, ts)
    if resolution is None:
        return []
    if resolution.allocation_mode == AllocationMode.COMMUNITY:
        zev_id = mp_to_zev.get(metering_point_id)
        day = civil_date(ts)
        return list(shares_by_zev.get(zev_id, {}).get(day, {}).items())
    return [(resolution.holder_id, Decimal("1"))]


def _flagged_metering_point_ids(readings_qs) -> set:
    """Metering point ids among ``readings_qs`` that have generation behind the meter."""
    return set(
        MeteringPoint.objects.filter(
            id__in=readings_qs.values_list("metering_point_id", flat=True).distinct(),
            has_behind_meter_generation=True,
        ).values_list("id", flat=True)
    )


def net_metered_participant_ids(windows, readings_qs, flagged_mp_ids=None) -> set[str]:
    """Participants who personally held a meter with generation behind it
    for at least one reading in ``readings_qs``.

    A participant is net-metered if, for at least one reading of a flagged
    metering point in ``readings_qs``, ``windows.assignment_at`` attributes
    that reading to them through a personal assignment. Community-mode
    assignments on a flagged meter never make anyone net-metered — their
    readings are split by weight, so no single participant's rate is
    distorted. Short-circuits with no window resolution at all when the ZEV
    has no flagged meter, which is the common case. Callers that already
    looked up ``flagged_mp_ids`` pass them to save the query.
    """
    if flagged_mp_ids is None:
        flagged_mp_ids = _flagged_metering_point_ids(readings_qs)
    if not flagged_mp_ids:
        return set()

    participant_ids: set[str] = set()
    distinct_ts = (
        readings_qs.filter(metering_point_id__in=flagged_mp_ids)
        .values_list("metering_point_id", "timestamp")
        .distinct()
    )
    for mp_id, ts in distinct_ts:
        resolution = windows.assignment_at(mp_id, ts)
        if resolution is not None and resolution.allocation_mode == AllocationMode.PERSONAL:
            participant_ids.add(str(resolution.holder_id))
    return participant_ids


def _participant_names(participant_ids) -> dict[str, str]:
    """``{participant_id: "First Last"}`` for the given participant ids."""
    names = {}
    for participant in Participant.objects.filter(id__in=participant_ids):
        names[str(participant.id)] = f"{participant.first_name} {participant.last_name}".strip()
    return names


def _bucket_bounds(ts, trunc_fn) -> tuple[str, datetime]:
    """Return the ISO bucket key and exclusive UTC end for sorted-row reuse.

    Day/month buckets use the supplied or current Django timezone. Hour buckets
    require UTC to keep the repeated autumn hours distinct (ADR 0026).
    """
    func = getattr(trunc_fn, "func", trunc_fn)
    tzinfo = getattr(trunc_fn, "keywords", {}).get("tzinfo") or get_current_timezone()
    local = ts.astimezone(tzinfo)
    if func is TruncHour:
        # ZoneInfo returns zero for UTC but None for date-dependent zones such as Zurich.
        if tzinfo.utcoffset(None) != timedelta(0):
            raise ValueError("Hourly dashboard buckets require a UTC timezone.")
        bucket = local.replace(minute=0, second=0, microsecond=0)
        next_bucket = bucket + timedelta(hours=1)
    elif func is TruncMonth:
        bucket = local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        next_bucket = bucket.replace(day=28) + timedelta(days=4)
        next_bucket = next_bucket.replace(day=1)
    elif func is TruncDay:
        bucket = local.replace(hour=0, minute=0, second=0, microsecond=0)
        # ZoneInfo keeps wall-clock midnight across DST changes.
        next_bucket = bucket + timedelta(days=1)
    else:
        raise ValueError("Unsupported dashboard truncation.")
    return bucket.isoformat(), next_bucket.astimezone(dt_timezone.utc)


# ---------------------------------------------------------------------------
# Owner / admin dashboard
# ---------------------------------------------------------------------------

def _zev_balance(qs, trunc_fn):
    """ZEV-wide energy balance of a readings queryset.

    Import and export are netted per timestamp — what the ZEV could not cover
    locally in that quarter hour — before being summed into buckets, so a
    sunny noon cannot offset a dark evening.

    Returns ``(ts_pivot, timeline, totals)``: the per-timestamp
    consumed/produced pivot (the per-participant split needs it), the bucket
    timeline as floats, and the period totals as Decimals.
    """
    # One row per timestamp with both directions, instead of one row per
    # timestamp and direction. The bucket is derived in Python (see
    # ``_bucket_bounds``) rather than truncated for every row in SQL.
    zev_ts_rows = (
        qs.values("timestamp")
        .annotate(
            consumed_kwh=Sum("energy_kwh", filter=Q(direction="in")),
            produced_kwh=Sum("energy_kwh", filter=Q(direction="out")),
        )
        .order_by("timestamp")
    )
    ts_pivot = {}
    bucket_key = None
    bucket_end = None
    for row in zev_ts_rows:
        ts = row["timestamp"]
        if bucket_key is None or ts >= bucket_end:
            bucket_key, bucket_end = _bucket_bounds(ts, trunc_fn)
        ts_pivot[ts] = {
            "bucket": bucket_key,
            "consumed_kwh": row["consumed_kwh"] or Decimal("0"),
            "produced_kwh": row["produced_kwh"] or Decimal("0"),
        }

    # --- Bucket-level aggregation and totals ---
    timeline, totals = _timeline_and_totals(ts_pivot)
    return ts_pivot, timeline, totals


def _timeline_and_totals(ts_pivot):
    """Aggregate a ``{timestamp: {bucket, consumed_kwh, produced_kwh}}`` pivot."""
    bucket_pivot = {}
    totals = {
        "produced_kwh": Decimal("0"),
        "consumed_kwh": Decimal("0"),
        "imported_kwh": Decimal("0"),
        "exported_kwh": Decimal("0"),
    }
    for _, data in sorted(ts_pivot.items(), key=lambda item: item[0]):
        bucket_key = data["bucket"]
        consumed = data["consumed_kwh"]
        produced = data["produced_kwh"]
        imported = max(consumed - produced, Decimal("0"))
        exported = max(produced - consumed, Decimal("0"))

        if bucket_key not in bucket_pivot:
            bucket_pivot[bucket_key] = {
                "bucket": bucket_key,
                "consumed_kwh": Decimal("0"),
                "produced_kwh": Decimal("0"),
                "imported_kwh": Decimal("0"),
                "exported_kwh": Decimal("0"),
            }
        bucket_pivot[bucket_key]["consumed_kwh"] += consumed
        bucket_pivot[bucket_key]["produced_kwh"] += produced
        bucket_pivot[bucket_key]["imported_kwh"] += imported
        bucket_pivot[bucket_key]["exported_kwh"] += exported

        totals["produced_kwh"] += produced
        totals["consumed_kwh"] += consumed
        totals["imported_kwh"] += imported
        totals["exported_kwh"] += exported

    timeline = [
        {
            "bucket": item["bucket"],
            "consumed_kwh": float(item["consumed_kwh"]),
            "produced_kwh": float(item["produced_kwh"]),
            "imported_kwh": float(item["imported_kwh"]),
            "exported_kwh": float(item["exported_kwh"]),
        }
        for _, item in sorted(bucket_pivot.items(), key=lambda entry: entry[0])
    ]
    return timeline, totals


def zev_balance_timeline(qs, trunc_fn):
    """``(timeline, totals)`` of the ZEV-wide balance, without the per-participant split.

    The cheap half of :func:`owner_dashboard_summary`, for callers that only
    need the community's figures.
    Totals are floats, like the timeline.
    """
    _, timeline, totals = _zev_balance(qs, trunc_fn)
    return timeline, {k: float(v) for k, v in totals.items()}


def owner_dashboard_summary(qs, trunc_fn, selected_participant_id):
    """
    Compute ZEV-owner/admin dashboard summary.

    qs              – MeterReading queryset already filtered to the desired ZEV
                      and date range.
    trunc_fn        – TruncDay/TruncMonth, or TruncHour with a UTC timezone;
                      partial(..., tzinfo=...) overrides Django's current timezone.
    selected_participant_id – optional UUID str to scope totals & timeline.

    Returns a dict matching the existing API response shape.  The caller
    should add the ``"bucket"`` key before returning to the client.
    """
    today = date_type.today()

    # --- Per-participant breakdown ---
    # Readings are attributed to the participant whose assignment is active at
    # the reading's timestamp (ADR 0013), not to whoever holds it today.
    window_start, window_end = _qs_bounds(qs, today)
    windows = _assignment_windows_for_readings(qs, window_start, window_end)
    mp_to_zev, shares_by_zev = _community_shares_by_zev(
        qs.values_list("metering_point_id", flat=True).distinct(), window_start, window_end,
    )
    flagged_mp_ids = _flagged_metering_point_ids(qs)
    zev_has_behind_meter_generation = bool(flagged_mp_ids)
    net_metered_ids = net_metered_participant_ids(windows, qs, flagged_mp_ids)

    participant_rows = (
        qs.values_list(
            "metering_point_id",
            "timestamp",
        )
        .annotate(
            consumed_kwh=Sum("energy_kwh", filter=Q(direction="in")),
            produced_kwh=Sum("energy_kwh", filter=Q(direction="out")),
        )
        .order_by("timestamp", "metering_point_id")  # groupby needs consecutive timestamps.
    )

    # Stream the whole physical pool one timestamp at a time, including
    # unassigned meters; retain timestamp totals for the global timeline.
    ts_pivot = {}
    participant_map = {}
    selected_timeline = {}
    pid_cache = {}
    day_end = None
    distributions_by_mp = {}
    bucket_key = None
    bucket_end = None
    for ts, rows in groupby(participant_rows.iterator(chunk_size=2000), key=lambda row: row[1]):
        rows = list(rows)
        total_consumed = sum((row[2] for row in rows if row[2] is not None), Decimal("0"))
        total_produced = sum((row[3] for row in rows if row[3] is not None), Decimal("0"))
        if bucket_key is None or ts >= bucket_end:
            bucket_key, bucket_end = _bucket_bounds(ts, trunc_fn)
        ts_pivot[ts] = {
            "bucket": bucket_key,
            "consumed_kwh": total_consumed,
            "produced_kwh": total_produced,
        }
        if day_end is None or ts >= day_end:
            day_end = period_end_exclusive_dt(civil_date(ts))
            distributions_by_mp = {}

        for metering_point_id, _, consumed_kwh, produced_kwh in rows:
            if metering_point_id not in distributions_by_mp:
                distributions_by_mp[metering_point_id] = tuple(_distribute_reading(
                    windows, mp_to_zev, shares_by_zev, metering_point_id, ts,
                ))
            distributions = distributions_by_mp[metering_point_id]

            has_consumption = consumed_kwh is not None
            has_production = produced_kwh is not None
            consumed = consumed_kwh or Decimal("0")
            produced = produced_kwh or Decimal("0")

            from_zev = from_grid = exported = Decimal("0")
            if has_consumption:
                from_zev, from_grid = split_consumption(consumed, total_consumed, total_produced)
            if has_production:
                # Exported per timestamp = the producer's share of what the ZEV
                # could not consume locally — mirrors what the engine bills as
                # feed-in (ADR 0013), so the chart reconciles with the invoice.
                _, exported = split_production(produced, total_produced, total_consumed)

            for raw_pid, share in distributions:
                try:
                    pid = pid_cache[raw_pid]
                except KeyError:
                    pid = pid_cache[raw_pid] = str(raw_pid)
                if pid not in participant_map:
                    participant_map[pid] = {
                        "participant_id": pid,
                        "total_consumed_kwh": Decimal("0"),
                        "total_produced_kwh": Decimal("0"),
                        "from_zev_kwh": Decimal("0"),
                        "from_grid_kwh": Decimal("0"),
                        "total_exported_kwh": Decimal("0"),
                    }
                item = participant_map[pid]
                if has_consumption:
                    item["total_consumed_kwh"] += consumed * share
                    item["from_zev_kwh"] += from_zev * share
                    item["from_grid_kwh"] += from_grid * share
                if has_production:
                    item["total_produced_kwh"] += produced * share
                    item["total_exported_kwh"] += exported * share

                # Only the selected participant's timeline is returned.
                if pid == selected_participant_id:
                    if bucket_key not in selected_timeline:
                        selected_timeline[bucket_key] = {
                            "bucket": bucket_key,
                            "consumed_kwh": Decimal("0"),
                            "produced_kwh": Decimal("0"),
                            "imported_kwh": Decimal("0"),
                            "exported_kwh": Decimal("0"),
                        }
                    bucket = selected_timeline[bucket_key]
                    if has_consumption:
                        bucket["consumed_kwh"] += consumed * share
                        bucket["imported_kwh"] += from_grid * share
                    if has_production:
                        bucket["produced_kwh"] += produced * share
                        bucket["exported_kwh"] += exported * share

    timeline, totals = _timeline_and_totals(ts_pivot)

    names = _participant_names(participant_map)
    for pid, item in participant_map.items():
        item["participant_name"] = names.get(pid, "")

    participant_stats = sorted(
        [
            {
                "participant_id": item["participant_id"],
                "participant_name": item["participant_name"],
                "total_consumed_kwh": float(item["total_consumed_kwh"]),
                "total_produced_kwh": float(item["total_produced_kwh"]),
                "from_zev_kwh": float(item["from_zev_kwh"]),
                "from_grid_kwh": float(item["from_grid_kwh"]),
                "has_behind_meter_generation": item["participant_id"] in net_metered_ids,
            }
            for item in participant_map.values()
        ],
        key=lambda item: (-item["total_consumed_kwh"], item["participant_id"]),
    )

    response_totals = {k: float(v) for k, v in totals.items()}
    zev_wide_totals = dict(response_totals)
    response_timeline = timeline
    selected_participant_name = None

    if selected_participant_id and selected_participant_id in participant_map:
        selected = participant_map[selected_participant_id]
        selected_participant_name = selected["participant_name"]
        response_totals = {
            "produced_kwh": float(selected["total_produced_kwh"]),
            "consumed_kwh": float(selected["total_consumed_kwh"]),
            "imported_kwh": float(selected["from_grid_kwh"]),
            "exported_kwh": float(selected["total_exported_kwh"]),
        }
        response_timeline = [
            {
                "bucket": item["bucket"],
                "consumed_kwh": float(item["consumed_kwh"]),
                "produced_kwh": float(item["produced_kwh"]),
                "imported_kwh": float(item["imported_kwh"]),
                "exported_kwh": float(item["exported_kwh"]),
            }
            for _, item in sorted(selected_timeline.items(), key=lambda entry: entry[0])
        ]

    return {
        "summary_kind": "zev",
        "totals": response_totals,
        "zev_totals": zev_wide_totals,
        "timeline": response_timeline,
        "participant_stats": participant_stats,
        "selected_participant_id": selected_participant_id,
        "selected_participant_name": selected_participant_name,
        "zev_has_behind_meter_generation": zev_has_behind_meter_generation,
    }


# ---------------------------------------------------------------------------
# Participant dashboard
# ---------------------------------------------------------------------------

def participant_dashboard_summary(zev_qs, trunc_fn, user, zev_ids):
    """
    Compute participant dashboard summary.

    zev_qs          – Readings of enabled membership ZEVs, date-filtered.
    trunc_fn        – TruncDay/TruncMonth, or TruncHour with a UTC timezone;
                      partial(..., tzinfo=...) overrides Django's current timezone.
    user            – request.user (used to find current_participant_ids).
    zev_ids         – queryset / list of enabled membership ZEV UUIDs.

    Returns a dict matching the existing API response shape.  The caller
    should add the ``"bucket"`` key before returning to the client.
    """
    today = date_type.today()

    # Cards, timeline and flow use the same readings and attribution windows.
    # A community share belongs to an eligible member even when they hold no
    # assignment on that meter; raw-reading visibility cannot define this set.
    window_start, window_end = _qs_bounds(zev_qs, today)
    windows = _assignment_windows_for_readings(zev_qs, window_start, window_end)
    current_participant_ids = set(
        Participant.objects.filter(access.live_participant_q(), user=user, zev_id__in=zev_ids)
        .values_list("id", flat=True)
    )
    mp_to_zev, shares_by_zev = _community_shares_by_zev(
        zev_qs.values_list("metering_point_id", flat=True).distinct(), window_start, window_end,
    )

    reading_rows = list(
        zev_qs.values_list("metering_point_id", "timestamp")
        .annotate(
            consumed_kwh=Sum("energy_kwh", filter=Q(direction="in")),
            produced_kwh=Sum("energy_kwh", filter=Q(direction="out")),
        )
        .order_by("metering_point_id", "timestamp")
    )

    # Build the per-ZEV/timestamp pool from the same rows the attribution
    # loop consumes, instead of scanning the readings a second time.
    zev_pivot = {}
    for metering_point_id, ts, consumed_kwh, produced_kwh in reading_rows:
        key = (mp_to_zev[metering_point_id], ts)
        data = zev_pivot.get(key)
        if data is None:
            data = zev_pivot[key] = {
                "consumed": Decimal("0"),
                "produced": Decimal("0"),
            }
        if consumed_kwh is not None:
            data["consumed"] += consumed_kwh
        if produced_kwh is not None:
            data["produced"] += produced_kwh

    timeline_map = {}
    totals = {
        "consumed_from_zev_kwh": Decimal("0"),
        "imported_from_grid_kwh": Decimal("0"),
        "total_consumed_kwh": Decimal("0"),
    }

    # ZEV-wide totals & per-participant stats (Sankey data)
    zev_totals = {
        "produced_kwh": Decimal("0"),
        "consumed_kwh": Decimal("0"),
        "imported_kwh": Decimal("0"),
        "exported_kwh": Decimal("0"),
    }
    for _, data in zev_pivot.items():
        consumed = data["consumed"]
        produced = data["produced"]
        zev_totals["produced_kwh"] += produced
        zev_totals["consumed_kwh"] += consumed
        zev_totals["imported_kwh"] += max(consumed - produced, Decimal("0"))
        zev_totals["exported_kwh"] += max(produced - consumed, Decimal("0"))

    # ZEV-wide per-participant stats (Sankey data), attributed per timestamp.
    zev_flagged_mp_ids = _flagged_metering_point_ids(zev_qs)
    zev_has_behind_meter_generation = bool(zev_flagged_mp_ids)
    zev_net_metered_ids = net_metered_participant_ids(windows, zev_qs, zev_flagged_mp_ids)
    has_behind_meter_generation = bool(
        {str(pid) for pid in current_participant_ids} & zev_net_metered_ids
    )

    participant_map = {}
    pid_cache = {}
    current_metering_point_id = None
    day = None
    day_end = None
    distributions = ()
    bucket_key = None
    bucket_end = None
    for metering_point_id, ts, consumed_kwh, produced_kwh in reading_rows:
        if metering_point_id != current_metering_point_id:
            current_metering_point_id = metering_point_id
            day = None
            bucket_key = None
        if day is None or ts >= day_end:
            day = civil_date(ts)
            day_end = period_end_exclusive_dt(day)
            distributions = tuple(_distribute_reading(
                windows, mp_to_zev, shares_by_zev, metering_point_id, ts,
            ))
        if bucket_key is None or ts >= bucket_end:
            bucket_key, bucket_end = _bucket_bounds(ts, trunc_fn)

        has_consumption = consumed_kwh is not None
        has_production = produced_kwh is not None
        consumed = consumed_kwh or Decimal("0")
        produced = produced_kwh or Decimal("0")

        zev_at_ts = zev_pivot[(mp_to_zev[metering_point_id], ts)]
        total_consumed = zev_at_ts["consumed"]
        total_produced = zev_at_ts["produced"]
        from_zev = from_grid = Decimal("0")
        if has_consumption:
            from_zev, from_grid = split_consumption(consumed, total_consumed, total_produced)

        for raw_pid, share in distributions:
            try:
                pid = pid_cache[raw_pid]
            except KeyError:
                pid = pid_cache[raw_pid] = str(raw_pid)
            if pid not in participant_map:
                participant_map[pid] = {
                    "participant_id": pid,
                    "total_consumed_kwh": Decimal("0"),
                    "total_produced_kwh": Decimal("0"),
                    "from_zev_kwh": Decimal("0"),
                    "from_grid_kwh": Decimal("0"),
                }

            item = participant_map[pid]
            if has_consumption:
                item["total_consumed_kwh"] += consumed * share
                item["from_zev_kwh"] += from_zev * share
                item["from_grid_kwh"] += from_grid * share

                if raw_pid in current_participant_ids:
                    if bucket_key not in timeline_map:
                        timeline_map[bucket_key] = {
                            "bucket": bucket_key, **dict.fromkeys(totals, Decimal("0")),
                        }
                    bucket = timeline_map[bucket_key]
                    for total_key, value in (
                        ("total_consumed_kwh", consumed * share),
                        ("consumed_from_zev_kwh", from_zev * share),
                        ("imported_from_grid_kwh", from_grid * share),
                    ):
                        totals[total_key] += value
                        bucket[total_key] += value

            if has_production:
                item["total_produced_kwh"] += produced * share

    timeline = [
        {
            "bucket": item["bucket"],
            "consumed_from_zev_kwh": float(item["consumed_from_zev_kwh"]),
            "imported_from_grid_kwh": float(item["imported_from_grid_kwh"]),
            "total_consumed_kwh": float(item["total_consumed_kwh"]),
        }
        for _, item in sorted(timeline_map.items(), key=lambda entry: entry[0])
    ]

    zev_names = _participant_names(participant_map)
    zev_participant_stats = sorted(
        [
            {
                "participant_id": item["participant_id"],
                "participant_name": zev_names.get(item["participant_id"], ""),
                "total_consumed_kwh": float(item["total_consumed_kwh"]),
                "total_produced_kwh": float(item["total_produced_kwh"]),
                "from_zev_kwh": float(item["from_zev_kwh"]),
                "from_grid_kwh": float(item["from_grid_kwh"]),
                "has_behind_meter_generation": item["participant_id"] in zev_net_metered_ids,
            }
            for item in participant_map.values()
        ],
        key=lambda x: x["total_consumed_kwh"],
        reverse=True,
    )

    return {
        "summary_kind": "participant",
        "totals": {k: float(v) for k, v in totals.items()},
        "timeline": timeline,
        "zev_totals": {k: float(v) for k, v in zev_totals.items()},
        "zev_participant_stats": zev_participant_stats,
        "current_participant_id": (
            str(min(current_participant_ids)) if current_participant_ids else None
        ),
        "has_behind_meter_generation": has_behind_meter_generation,
        "zev_has_behind_meter_generation": zev_has_behind_meter_generation,
    }


# ---------------------------------------------------------------------------
# Hourly profile
# ---------------------------------------------------------------------------

def compute_hourly_profile(selected_zev_id, participant_ids, start_dt, end_dt, ps, pe):
    """
    Compute 24-hour average daily consumption profile for the given participants.

    selected_zev_id  – ZEV UUID string.
    participant_ids  – list of Participant UUIDs to scope consumption.
    start_dt / end_dt – UTC-aware datetimes bounding the query window.
    ps / pe          – date objects (period start / end) for assignment validity
                       checks and day-count averaging.

    Returns ``{"hourly_profile": list}`` or ``{"hourly_profile": None}``.
    """
    # A meter matters here if one of the selected participants personally
    # holds it, OR it is community-allocated (any participant of the ZEV may
    # be weight-eligible for a share, regardless of who the literal holder
    # is) — otherwise a community-only participant's meter never reaches the
    # profile at all. Two flat queries unioned in Python rather than one
    # composite filter: both conditions traverse the same ``assignments``
    # relation, and Django's multi-valued-join semantics for OR-ed conditions
    # on one relation are easy to get subtly wrong.
    personal_mp_ids = active_during(
        MeteringPointAssignment.objects.filter(
            metering_point__zev_id=selected_zev_id,
            metering_point__meter_type__in=CONSUMPTION_METER_TYPES,
            participant_id__in=participant_ids,
        ),
        ps,
        pe,
    ).values_list("metering_point_id", flat=True)
    community_mp_ids = active_during(
        MeteringPointAssignment.objects.filter(
            metering_point__zev_id=selected_zev_id,
            metering_point__meter_type__in=CONSUMPTION_METER_TYPES,
            allocation_mode=AllocationMode.COMMUNITY,
        ),
        ps,
        pe,
    ).values_list("metering_point_id", flat=True)
    consumption_mps = MeteringPoint.objects.filter(
        id__in=set(personal_mp_ids) | set(community_mp_ids)
    )

    participant_readings_qs = MeterReading.objects.filter(
        metering_point__in=consumption_mps,
        timestamp__gte=start_dt,
        timestamp__lt=end_dt,
        direction="in",
    )
    participant_readings = list(participant_readings_qs.order_by("timestamp"))

    if not participant_readings:
        return {"hourly_profile": None, "has_behind_meter_generation": False}

    resolutions = {r.resolution for r in participant_readings}
    if resolutions == {"daily"}:
        return {"hourly_profile": None, "has_behind_meter_generation": False}

    # Per-timestamp attribution: a reading only counts while one of the
    # selected participants held the metering point at its timestamp (ADR 0013)
    # — personally, or by a weighted community share.
    participant_ids_set = {str(pid) for pid in participant_ids}
    windows = _assignment_windows_for_readings(
        participant_readings_qs, ps, pe
    )
    mp_to_zev, shares_by_zev = _community_shares_by_zev(
        participant_readings_qs.values_list("metering_point_id", flat=True).distinct(), ps, pe,
    )
    net_metered_ids = net_metered_participant_ids(windows, participant_readings_qs)
    has_behind_meter_generation = bool(participant_ids_set & net_metered_ids)

    # The pool covers every metering point of the ZEV regardless of assignment
    # (ADR 0013), matching the engine and the PDFs. Shared read-model helper:
    # one definition of the physical per-timestamp pool across all consumers.
    zev_cons_by_ts, zev_prod_by_ts = community_totals_by_timestamp(
        selected_zev_id, start_dt, end_dt
    )

    # Decimal arithmetic end to end (the billing contract); floats only at
    # serialization.
    hourly_local = [Decimal("0")] * 24
    hourly_grid = [Decimal("0")] * 24

    for reading in participant_readings:
        ts = reading.timestamp
        # The selected participants' combined share: 1 if one of them
        # personally holds the meter, their normalized weight share for a
        # community assignment, 0 for a gap or somebody else's meter — it
        # must not shape their profile.
        my_share = sum(
            share for raw_pid, share in _distribute_reading(
                windows, mp_to_zev, shares_by_zev, reading.metering_point_id, ts,
            )
            if str(raw_pid) in participant_ids_set
        )
        if my_share == 0:
            continue
        hour = wall_clock(ts).hour
        p_kwh = reading.energy_kwh * my_share
        zev_cons = zev_cons_by_ts.get(ts, Decimal("0"))
        zev_prod = zev_prod_by_ts.get(ts, Decimal("0"))
        r_local, r_grid = split_consumption(p_kwh, zev_cons, zev_prod)
        hourly_local[hour] += r_local
        hourly_grid[hour] += r_grid

    total_days = (pe - ps).days + 1
    hourly_local = [v / total_days for v in hourly_local]
    hourly_grid = [v / total_days for v in hourly_grid]

    profile = [
        {
            "hour": h,
            "from_zev_kwh": float(hourly_local[h].quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
            "from_grid_kwh": float(hourly_grid[h].quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)),
        }
        for h in range(24)
    ]
    return {"hourly_profile": profile, "has_behind_meter_generation": has_behind_meter_generation}


# ---------------------------------------------------------------------------
# Data quality
# ---------------------------------------------------------------------------

def compute_data_quality_status(metering_points, date_from, date_to):
    """
    Detect missing daily readings per metering point, and readings that have
    no assignment holder at their timestamp.

    metering_points – MeteringPoint queryset.
    date_from / date_to – date objects defining the inspection window.

    A reading whose metering point has no assignment active at the reading's
    UTC civil date is billed to nobody but still inflates the ZEV pool (ADR
    0013); that is always a misconfiguration, so such readings are counted
    per metering point as ``unassigned_readings`` / ``unassigned_days``.
    Holders are resolved once per distinct day (assignment validity is
    date-granular), and the per-meter ``assignment_overlap`` flag marks
    metering points whose windows overlap, so one corrupt meter degrades to
    one bad row instead of failing the whole status page.

    The displayed ``participant_name`` is the holder of the assignment with
    the latest ``valid_from`` among those overlapping ``[date_from,
    date_to]`` — i.e. the most recent holder *within the reviewed period*,
    not whoever holds the meter today. Resolving via ``today`` would show a
    reviewer of e.g. last quarter's data the participant who has since moved
    in, which is both misleading (wrong contact to follow up a gap with) and
    an unnecessary cross-participant exposure of who holds a meter now.

    Returns a list of status dicts, one per metering point.
    """
    all_days = set()
    current = date_from
    while current <= date_to:
        all_days.add(current)
        current += timedelta(days=1)

    assignment_rows = active_during(
        MeteringPointAssignment.objects.filter(metering_point__in=metering_points),
        date_from,
        date_to,
    ).values_list(
        "metering_point_id", "valid_from", "valid_to", "participant_id",
        "allocation_mode", "id",
    )

    windows_by_mp: dict = {}
    for row in assignment_rows:
        windows_by_mp.setdefault(row[0], []).append(row)

    # The most recent assignment (by valid_from) among those overlapping the
    # period, per metering point — see the "displayed participant_name"
    # note above. ``row[1]`` is valid_from, ``row[3]`` is participant_id.
    period_holder_by_mp = {
        mp_id: max(rows, key=lambda row: row[1])[3]
        for mp_id, rows in windows_by_mp.items()
    }
    participant_names = {
        participant.id: participant.full_name
        for participant in Participant.objects.filter(
            id__in=set(period_holder_by_mp.values())
        )
    }

    # One grouped query for every meter: (meter, Swiss civil day) -> count.
    # The database buckets the days (never ``timestamp__date``, ADR 0026), so
    # only one row per meter and day reaches Python, not one per reading.
    window_start, window_end = period_window(date_from, date_to)
    readings_per_day_by_mp: dict = defaultdict(dict)
    for mp_id, day, count in (
        MeterReading.objects.filter(
            metering_point__in=metering_points,
            timestamp__gte=window_start,
            timestamp__lt=window_end,
        )
        .annotate(day=TruncDate("timestamp", tzinfo=business_tz()))
        .values_list("metering_point_id", "day")
        .annotate(count=Count("id"))
        .order_by()
    ):
        readings_per_day_by_mp[mp_id][day] = count

    result = []
    for mp in metering_points:
        try:
            windows = AssignmentWindows(windows_by_mp.get(mp.id, ()))
        except OverlappingAssignmentWindowsError:
            windows = None

        readings_per_day = readings_per_day_by_mp.get(mp.id, {})
        days_with_data = set(readings_per_day)

        missing_days = sorted(all_days - days_with_data)
        gaps = []
        if missing_days:
            gap_start = gap_end = missing_days[0]
            for day in missing_days[1:]:
                if day == gap_end + timedelta(days=1):
                    gap_end = day
                else:
                    gaps.append({
                        "start_date": gap_start.isoformat(),
                        "end_date": gap_end.isoformat(),
                        "duration_days": (gap_end - gap_start).days + 1,
                    })
                    gap_start = gap_end = day
            gaps.append({
                "start_date": gap_start.isoformat(),
                "end_date": gap_end.isoformat(),
                "duration_days": (gap_end - gap_start).days + 1,
            })

        data_completeness = int(100 * len(days_with_data) / len(all_days)) if all_days else 0
        if data_completeness == 100:
            severity = "green"
        elif data_completeness >= 50:
            severity = "yellow"
        else:
            severity = "red"

        unassigned_days = set()
        unassigned_readings = 0
        if windows is not None:
            for day in days_with_data:
                if windows.participant_on(mp.id, day) is None:
                    unassigned_days.add(day)
                    unassigned_readings += readings_per_day[day]

        result.append({
            "id": str(mp.id),
            "meter_id": mp.meter_id,
            "participant_name": participant_names.get(period_holder_by_mp.get(mp.id), "Unassigned"),
            "severity": severity,
            "data_completeness": data_completeness,
            "days_with_data": len(days_with_data),
            "total_days": len(all_days),
            "gaps": gaps,
            "unassigned_days": len(unassigned_days),
            "unassigned_readings": unassigned_readings,
            "assignment_overlap": windows is None,
        })

    return result
