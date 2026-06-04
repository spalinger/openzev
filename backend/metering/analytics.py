"""
Pure analytics functions extracted from MeterReadingViewSet.

These functions receive pre-filtered querysets / parameters and return plain
dicts that views can hand straight to Response().  No HTTP or permission logic
lives here, which makes the calculations independently unit-testable.
"""
from datetime import date as date_type, datetime, timedelta, timezone as dt_timezone
from decimal import Decimal

from django.db.models import Q, Sum

from zev.models import Participant, MeteringPoint, MeteringPointType
from .models import MeterReading


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _pname(row, prefix="metering_point__assignments__participant__"):
    first = (row.get(f"{prefix}first_name") or "").strip()
    last = (row.get(f"{prefix}last_name") or "").strip()
    return f"{first} {last}".strip()


# ---------------------------------------------------------------------------
# Owner / admin dashboard
# ---------------------------------------------------------------------------

def owner_dashboard_summary(qs, trunc_fn, selected_participant_id):
    """
    Compute ZEV-owner/admin dashboard summary.

    qs              – MeterReading queryset already filtered to the desired ZEV
                      and date range.
    trunc_fn        – Django ORM truncation class (TruncDay / TruncHour / …).
    selected_participant_id – optional UUID str to scope totals & timeline.

    Returns a dict matching the existing API response shape.  The caller
    should add the ``"bucket"`` key before returning to the client.
    """
    today = date_type.today()
    base = qs.annotate(bucket=trunc_fn("timestamp"))

    # --- ZEV-wide pivot by timestamp ---
    zev_ts_rows = (
        base.values("bucket", "timestamp", "direction")
        .annotate(total_kwh=Sum("energy_kwh"))
        .order_by("timestamp")
    )
    ts_pivot = {}
    for row in zev_ts_rows:
        ts = row["timestamp"]
        if ts not in ts_pivot:
            ts_pivot[ts] = {
                "bucket": row["bucket"].isoformat(),
                "consumed_kwh": Decimal("0"),
                "produced_kwh": Decimal("0"),
            }
        if row["direction"] == "in":
            ts_pivot[ts]["consumed_kwh"] = row["total_kwh"] or Decimal("0")
        elif row["direction"] == "out":
            ts_pivot[ts]["produced_kwh"] = row["total_kwh"] or Decimal("0")

    # --- Bucket-level aggregation and totals ---
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

    # --- Per-participant breakdown ---
    participant_rows = (
        base.filter(
            direction="in",
            metering_point__assignments__valid_from__lte=today,
        )
        .filter(
            Q(metering_point__assignments__valid_to__isnull=True)
            | Q(metering_point__assignments__valid_to__gte=today)
        )
        .values(
            "metering_point__assignments__participant_id",
            "metering_point__assignments__participant__first_name",
            "metering_point__assignments__participant__last_name",
            "timestamp",
            "bucket",
        )
        .annotate(consumed_kwh=Sum("energy_kwh"))
        .order_by("metering_point__assignments__participant_id", "timestamp")
    )

    participant_production_rows = (
        base.filter(
            direction="out",
            metering_point__assignments__valid_from__lte=today,
        )
        .filter(
            Q(metering_point__assignments__valid_to__isnull=True)
            | Q(metering_point__assignments__valid_to__gte=today)
        )
        .values(
            "metering_point__assignments__participant_id",
            "metering_point__assignments__participant__first_name",
            "metering_point__assignments__participant__last_name",
            "timestamp",
            "bucket",
        )
        .annotate(produced_kwh=Sum("energy_kwh"))
        .order_by("metering_point__assignments__participant_id", "timestamp")
    )

    participant_map = {}
    for row in participant_rows:
        pid = str(row["metering_point__assignments__participant_id"])
        ts = row["timestamp"]
        bucket_key = row["bucket"].isoformat()
        consumed = row["consumed_kwh"] or Decimal("0")

        zev_at_ts = ts_pivot.get(ts, {})
        total_consumed = zev_at_ts.get("consumed_kwh", Decimal("0"))
        total_produced = zev_at_ts.get("produced_kwh", Decimal("0"))
        local_pool = min(total_produced, total_consumed)
        if total_consumed > 0 and local_pool > 0:
            from_zev = min(consumed, local_pool * (consumed / total_consumed))
        else:
            from_zev = Decimal("0")
        from_grid = max(consumed - from_zev, Decimal("0"))

        if pid not in participant_map:
            participant_map[pid] = {
                "participant_id": pid,
                "participant_name": _pname(row),
                "total_consumed_kwh": Decimal("0"),
                "total_produced_kwh": Decimal("0"),
                "from_zev_kwh": Decimal("0"),
                "from_grid_kwh": Decimal("0"),
                "timeline_map": {},
            }
        participant_map[pid]["total_consumed_kwh"] += consumed
        participant_map[pid]["from_zev_kwh"] += from_zev
        participant_map[pid]["from_grid_kwh"] += from_grid

        if bucket_key not in participant_map[pid]["timeline_map"]:
            participant_map[pid]["timeline_map"][bucket_key] = {
                "bucket": bucket_key,
                "consumed_kwh": Decimal("0"),
                "produced_kwh": Decimal("0"),
                "imported_kwh": Decimal("0"),
                "exported_kwh": Decimal("0"),
            }
        participant_map[pid]["timeline_map"][bucket_key]["consumed_kwh"] += consumed
        participant_map[pid]["timeline_map"][bucket_key]["imported_kwh"] += from_grid

    for row in participant_production_rows:
        pid = str(row["metering_point__assignments__participant_id"])
        bucket_key = row["bucket"].isoformat()
        produced = row["produced_kwh"] or Decimal("0")

        if pid not in participant_map:
            participant_map[pid] = {
                "participant_id": pid,
                "participant_name": _pname(row),
                "total_consumed_kwh": Decimal("0"),
                "total_produced_kwh": Decimal("0"),
                "from_zev_kwh": Decimal("0"),
                "from_grid_kwh": Decimal("0"),
                "timeline_map": {},
            }
        participant_map[pid]["total_produced_kwh"] += produced

        if bucket_key not in participant_map[pid]["timeline_map"]:
            participant_map[pid]["timeline_map"][bucket_key] = {
                "bucket": bucket_key,
                "consumed_kwh": Decimal("0"),
                "produced_kwh": Decimal("0"),
                "imported_kwh": Decimal("0"),
                "exported_kwh": Decimal("0"),
            }
        participant_map[pid]["timeline_map"][bucket_key]["produced_kwh"] += produced
        participant_map[pid]["timeline_map"][bucket_key]["exported_kwh"] += produced

    participant_stats = sorted(
        [
            {
                "participant_id": item["participant_id"],
                "participant_name": item["participant_name"],
                "total_consumed_kwh": float(item["total_consumed_kwh"]),
                "total_produced_kwh": float(item["total_produced_kwh"]),
                "from_zev_kwh": float(item["from_zev_kwh"]),
                "from_grid_kwh": float(item["from_grid_kwh"]),
            }
            for item in participant_map.values()
        ],
        key=lambda x: x["total_consumed_kwh"],
        reverse=True,
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
            "exported_kwh": float(selected["total_produced_kwh"]),
        }
        response_timeline = [
            {
                "bucket": item["bucket"],
                "consumed_kwh": float(item["consumed_kwh"]),
                "produced_kwh": float(item["produced_kwh"]),
                "imported_kwh": float(item["imported_kwh"]),
                "exported_kwh": float(item["exported_kwh"]),
            }
            for _, item in sorted(selected["timeline_map"].items(), key=lambda entry: entry[0])
        ]

    return {
        "role": "zev_owner",
        "totals": response_totals,
        "zev_totals": zev_wide_totals,
        "timeline": response_timeline,
        "participant_stats": participant_stats,
        "selected_participant_id": selected_participant_id,
        "selected_participant_name": selected_participant_name,
    }


# ---------------------------------------------------------------------------
# Participant dashboard
# ---------------------------------------------------------------------------

def participant_dashboard_summary(participant_qs, zev_qs, trunc_fn, user, zev_ids):
    """
    Compute participant dashboard summary.

    participant_qs  – MeterReading queryset filtered to the participant's own
                      readings, already date-filtered.
    zev_qs          – MeterReading queryset for all ZEV readings, date-filtered.
    trunc_fn        – Django ORM truncation class.
    user            – request.user (used to find current_participant_ids).
    zev_ids         – queryset / list of ZEV UUIDs the participant belongs to.

    Returns a dict matching the existing API response shape.  The caller
    should add the ``"bucket"`` key before returning to the client.
    """
    today = date_type.today()
    base = participant_qs.annotate(bucket=trunc_fn("timestamp"))

    participant_rows = (
        base.filter(direction="in")
        .values("bucket", "timestamp")
        .annotate(consumed_kwh=Sum("energy_kwh"))
        .order_by("timestamp")
    )

    zev_rows = (
        zev_qs.annotate(bucket=trunc_fn("timestamp"))
        .values("bucket", "timestamp", "direction")
        .annotate(total_kwh=Sum("energy_kwh"))
        .order_by("timestamp")
    )

    zev_pivot = {}
    for row in zev_rows:
        key = row["timestamp"]
        if key not in zev_pivot:
            zev_pivot[key] = {"consumed": Decimal("0"), "produced": Decimal("0")}
        if row["direction"] == "in":
            zev_pivot[key]["consumed"] = row["total_kwh"] or Decimal("0")
        elif row["direction"] == "out":
            zev_pivot[key]["produced"] = row["total_kwh"] or Decimal("0")

    timeline_map = {}
    totals = {
        "consumed_from_zev_kwh": Decimal("0"),
        "imported_from_grid_kwh": Decimal("0"),
        "total_consumed_kwh": Decimal("0"),
    }

    for row in participant_rows:
        bucket_key = row["bucket"].isoformat()
        ts = row["timestamp"]
        participant_consumed = row["consumed_kwh"] or Decimal("0")
        zev_consumed = zev_pivot.get(ts, {}).get("consumed", Decimal("0"))
        zev_produced = zev_pivot.get(ts, {}).get("produced", Decimal("0"))
        local_pool = min(zev_produced, zev_consumed)
        if zev_consumed > 0 and local_pool > 0:
            consumed_from_zev = min(
                participant_consumed, local_pool * (participant_consumed / zev_consumed)
            )
        else:
            consumed_from_zev = Decimal("0")
        imported_from_grid = max(participant_consumed - consumed_from_zev, Decimal("0"))

        totals["consumed_from_zev_kwh"] += consumed_from_zev
        totals["imported_from_grid_kwh"] += imported_from_grid
        totals["total_consumed_kwh"] += participant_consumed

        if bucket_key not in timeline_map:
            timeline_map[bucket_key] = {
                "bucket": bucket_key,
                "consumed_from_zev_kwh": Decimal("0"),
                "imported_from_grid_kwh": Decimal("0"),
                "total_consumed_kwh": Decimal("0"),
            }
        timeline_map[bucket_key]["consumed_from_zev_kwh"] += consumed_from_zev
        timeline_map[bucket_key]["imported_from_grid_kwh"] += imported_from_grid
        timeline_map[bucket_key]["total_consumed_kwh"] += participant_consumed

    timeline = [
        {
            "bucket": item["bucket"],
            "consumed_from_zev_kwh": float(item["consumed_from_zev_kwh"]),
            "imported_from_grid_kwh": float(item["imported_from_grid_kwh"]),
            "total_consumed_kwh": float(item["total_consumed_kwh"]),
        }
        for _, item in sorted(timeline_map.items(), key=lambda entry: entry[0])
    ]

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

    all_consumption_rows = (
        zev_qs.annotate(bucket=trunc_fn("timestamp"))
        .filter(
            direction="in",
            metering_point__assignments__valid_from__lte=today,
        )
        .filter(
            Q(metering_point__assignments__valid_to__isnull=True)
            | Q(metering_point__assignments__valid_to__gte=today)
        )
        .values(
            "metering_point__assignments__participant_id",
            "metering_point__assignments__participant__first_name",
            "metering_point__assignments__participant__last_name",
            "timestamp",
        )
        .annotate(consumed_kwh=Sum("energy_kwh"))
        .order_by("metering_point__assignments__participant_id", "timestamp")
    )
    all_production_rows = (
        zev_qs.annotate(bucket=trunc_fn("timestamp"))
        .filter(
            direction="out",
            metering_point__assignments__valid_from__lte=today,
        )
        .filter(
            Q(metering_point__assignments__valid_to__isnull=True)
            | Q(metering_point__assignments__valid_to__gte=today)
        )
        .values(
            "metering_point__assignments__participant_id",
            "metering_point__assignments__participant__first_name",
            "metering_point__assignments__participant__last_name",
        )
        .annotate(produced_kwh=Sum("energy_kwh"))
        .order_by("metering_point__assignments__participant_id")
    )

    all_p_map = {}
    for row in all_consumption_rows:
        pid = str(row["metering_point__assignments__participant_id"])
        ts = row["timestamp"]
        consumed = row["consumed_kwh"] or Decimal("0")
        zev_at_ts = zev_pivot.get(ts, {})
        total_consumed = zev_at_ts.get("consumed", Decimal("0"))
        total_produced = zev_at_ts.get("produced", Decimal("0"))
        local_pool = min(total_produced, total_consumed)
        if total_consumed > 0 and local_pool > 0:
            from_zev = min(consumed, local_pool * (consumed / total_consumed))
        else:
            from_zev = Decimal("0")
        from_grid = max(consumed - from_zev, Decimal("0"))
        if pid not in all_p_map:
            all_p_map[pid] = {
                "participant_id": pid,
                "participant_name": _pname(row),
                "total_consumed_kwh": Decimal("0"),
                "total_produced_kwh": Decimal("0"),
                "from_zev_kwh": Decimal("0"),
                "from_grid_kwh": Decimal("0"),
            }
        all_p_map[pid]["total_consumed_kwh"] += consumed
        all_p_map[pid]["from_zev_kwh"] += from_zev
        all_p_map[pid]["from_grid_kwh"] += from_grid

    for row in all_production_rows:
        pid = str(row["metering_point__assignments__participant_id"])
        produced = row["produced_kwh"] or Decimal("0")
        if pid not in all_p_map:
            all_p_map[pid] = {
                "participant_id": pid,
                "participant_name": _pname(row),
                "total_consumed_kwh": Decimal("0"),
                "total_produced_kwh": Decimal("0"),
                "from_zev_kwh": Decimal("0"),
                "from_grid_kwh": Decimal("0"),
            }
        all_p_map[pid]["total_produced_kwh"] += produced

    zev_participant_stats = sorted(
        [
            {
                "participant_id": item["participant_id"],
                "participant_name": item["participant_name"],
                "total_consumed_kwh": float(item["total_consumed_kwh"]),
                "total_produced_kwh": float(item["total_produced_kwh"]),
                "from_zev_kwh": float(item["from_zev_kwh"]),
                "from_grid_kwh": float(item["from_grid_kwh"]),
            }
            for item in all_p_map.values()
        ],
        key=lambda x: x["total_consumed_kwh"],
        reverse=True,
    )

    current_participant_ids = list(
        Participant.objects.filter(user=user, zev_id__in=zev_ids).values_list("id", flat=True)
    )

    return {
        "role": "participant",
        "totals": {k: float(v) for k, v in totals.items()},
        "timeline": timeline,
        "zev_totals": {k: float(v) for k, v in zev_totals.items()},
        "zev_participant_stats": zev_participant_stats,
        "current_participant_id": str(current_participant_ids[0]) if current_participant_ids else None,
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
    consumption_mps = MeteringPoint.objects.filter(
        zev_id=selected_zev_id,
        meter_type__in=[MeteringPointType.CONSUMPTION, MeteringPointType.BIDIRECTIONAL],
        assignments__participant_id__in=participant_ids,
        assignments__valid_from__lte=pe,
    ).filter(
        Q(assignments__valid_to__isnull=True) | Q(assignments__valid_to__gte=ps)
    ).distinct()

    participant_readings = list(
        MeterReading.objects.filter(
            metering_point__in=consumption_mps,
            timestamp__gte=start_dt,
            timestamp__lt=end_dt,
            direction="in",
        ).order_by("timestamp")
    )

    if not participant_readings:
        return {"hourly_profile": None}

    resolutions = {r.resolution for r in participant_readings}
    if resolutions == {"daily"}:
        return {"hourly_profile": None}

    all_prod_mps = MeteringPoint.objects.filter(
        zev_id=selected_zev_id,
        meter_type__in=[MeteringPointType.PRODUCTION, MeteringPointType.BIDIRECTIONAL],
        assignments__valid_from__lte=pe,
    ).filter(
        Q(assignments__valid_to__isnull=True) | Q(assignments__valid_to__gte=ps)
    ).distinct()

    zev_prod_by_ts = {
        row["timestamp"]: float(row["total_kwh"] or 0)
        for row in MeterReading.objects.filter(
            metering_point__in=all_prod_mps,
            timestamp__gte=start_dt,
            timestamp__lt=end_dt,
            direction="out",
        ).values("timestamp").annotate(total_kwh=Sum("energy_kwh"))
    }

    all_cons_mps = MeteringPoint.objects.filter(
        zev_id=selected_zev_id,
        meter_type__in=[MeteringPointType.CONSUMPTION, MeteringPointType.BIDIRECTIONAL],
        assignments__valid_from__lte=pe,
    ).filter(
        Q(assignments__valid_to__isnull=True) | Q(assignments__valid_to__gte=ps)
    ).distinct()

    zev_cons_by_ts = {
        row["timestamp"]: float(row["total_kwh"] or 0)
        for row in MeterReading.objects.filter(
            metering_point__in=all_cons_mps,
            timestamp__gte=start_dt,
            timestamp__lt=end_dt,
            direction="in",
        ).values("timestamp").annotate(total_kwh=Sum("energy_kwh"))
    }

    hourly_local = [0.0] * 24
    hourly_grid = [0.0] * 24

    for reading in participant_readings:
        ts = reading.timestamp
        hour = ts.hour
        p_kwh = float(reading.energy_kwh)
        zev_cons = zev_cons_by_ts.get(ts, 0.0)
        zev_prod = zev_prod_by_ts.get(ts, 0.0)
        local_pool = min(zev_prod, zev_cons)
        if zev_cons > 0 and local_pool > 0:
            r_local = min(p_kwh, local_pool * p_kwh / zev_cons)
        else:
            r_local = 0.0
        r_grid = max(p_kwh - r_local, 0.0)
        hourly_local[hour] += r_local
        hourly_grid[hour] += r_grid

    total_days = (pe - ps).days + 1
    hourly_local = [v / total_days for v in hourly_local]
    hourly_grid = [v / total_days for v in hourly_grid]

    profile = [
        {
            "hour": h,
            "from_zev_kwh": round(hourly_local[h], 4),
            "from_grid_kwh": round(hourly_grid[h], 4),
        }
        for h in range(24)
    ]
    return {"hourly_profile": profile}


# ---------------------------------------------------------------------------
# Data quality
# ---------------------------------------------------------------------------

def compute_data_quality_status(metering_points, date_from, date_to, today):
    """
    Detect missing daily readings per metering point.

    metering_points – MeteringPoint queryset.
    date_from / date_to – date objects defining the inspection window.
    today           – date object (passed in so callers can control "now").

    Returns a list of status dicts, one per metering point.
    """
    all_days = set()
    current = date_from
    while current <= date_to:
        all_days.add(current)
        current += timedelta(days=1)

    result = []
    for mp in metering_points:
        readings_ts = MeterReading.objects.filter(
            metering_point=mp,
            timestamp__gte=datetime.combine(date_from, datetime.min.time(), tzinfo=dt_timezone.utc),
            timestamp__lt=datetime.combine(date_to, datetime.min.time(), tzinfo=dt_timezone.utc) + timedelta(days=1),
        ).values_list("timestamp", flat=True)

        days_with_data = {ts.date() for ts in readings_ts}

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

        assignment = (
            mp.assignments.filter(valid_from__lte=today)
            .filter(Q(valid_to__isnull=True) | Q(valid_to__gte=today))
            .order_by("-valid_from")
            .first()
        )
        participant_name = assignment.participant.full_name if assignment else "Unassigned"

        result.append({
            "id": str(mp.id),
            "meter_id": mp.meter_id,
            "participant_name": participant_name,
            "severity": severity,
            "data_completeness": data_completeness,
            "days_with_data": len(days_with_data),
            "total_days": len(all_days),
            "gaps": gaps,
        })

    return result
