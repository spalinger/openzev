"""
Pure query logic for the invoice period overview.

Extracted from InvoiceViewSet.period_overview so the data-assembly
logic can be tested and reasoned about independently of the DRF
request/response layer.
"""

from datetime import date as date_type

from allocation.validity import active_during, period_window
from zev.models import Participant, MeteringPointAssignment
from metering.models import MeterReading
from .models import Invoice
from .serializers import InvoiceSerializer


def compute_period_overview(*, zev, period_start: date_type, period_end: date_type, request) -> list[dict]:
    """Return one row per active participant for *zev* over the billing period.

    Each row contains:
    - participant identity fields
    - the participant's invoice for the period (or None)
    - metering completeness flags and gap details

    Only participants with at least one metering point assignment active
    during the period are included.
    """
    period_start_dt, period_end_exclusive_dt = period_window(period_start, period_end)

    participants = list(
        active_during(
            Participant.objects.filter(zev=zev), period_start, period_end
        ).order_by("last_name", "first_name")
    )

    invoice_map = {
        invoice.participant_id: invoice
        for invoice in Invoice.objects.filter(
            zev=zev,
            period_start=period_start,
            period_end=period_end,
        ).select_related("participant", "zev").order_by("-created_at")
    }

    rows = []
    assignments_by_participant: dict = {p.id: [] for p in participants}
    for assignment in active_during(
        MeteringPointAssignment.objects.filter(
            participant_id__in=assignments_by_participant.keys()
        ),
        period_start,
        period_end,
    ).select_related("metering_point"):
        assignments_by_participant[assignment.participant_id].append(assignment)

    all_mp_ids = {
        a.metering_point_id
        for assignments in assignments_by_participant.values()
        for a in assignments
    }
    readings_by_metering_point: dict[int, set] = {}
    for metering_point_id, timestamp in MeterReading.objects.filter(
        metering_point_id__in=all_mp_ids,
        timestamp__gte=period_start_dt,
        timestamp__lt=period_end_exclusive_dt,
    ).values_list("metering_point_id", "timestamp"):
        readings_by_metering_point.setdefault(metering_point_id, set()).add(timestamp.date())

    for participant in participants:
        assignments = assignments_by_participant[participant.id]

        if not assignments:
            continue

        missing_meter_ids = []
        missing_meter_details = []
        for assignment in assignments:
            mp = assignment.metering_point
            effective_start = max(period_start, assignment.valid_from)
            effective_end = min(
                period_end,
                assignment.valid_to if assignment.valid_to is not None else period_end,
            )

            if effective_start > effective_end:
                continue

            reading_days = readings_by_metering_point.get(mp.id, set())
            expected_days = (effective_end - effective_start).days + 1
            covered_days = sum(1 for d in reading_days if effective_start <= d <= effective_end)
            missing_days = expected_days - covered_days

            if missing_days > 0:
                missing_meter_ids.append(mp.meter_id)
                missing_meter_details.append({"meter_id": mp.meter_id, "missing_days": missing_days})

        total_metering_points = len(assignments)
        metering_points_with_data = total_metering_points - len(missing_meter_ids)
        metering_data_complete = total_metering_points > 0 and metering_points_with_data == total_metering_points

        invoice = invoice_map.get(participant.id)
        rows.append(
            {
                "participant_id": str(participant.id),
                "participant_name": participant.full_name,
                "participant_email": participant.email,
                "invoice": InvoiceSerializer(invoice, context={"request": request}).data if invoice else None,
                "metering_data_complete": metering_data_complete,
                "metering_points_total": total_metering_points,
                "metering_points_with_data": metering_points_with_data,
                "missing_meter_ids": missing_meter_ids,
                "missing_meter_details": missing_meter_details,
            }
        )

    return rows
