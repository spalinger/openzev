"""Invoice impact of committed billing-input changes.

A committed SDAT-CH/CSV correction (or an import deletion) never rewrites an
invoice; it records one :class:`InvoiceReadingImpact` row per affected
invoice instead. Callers run inside their own transaction — the importer
commit block, the deletion block — so flags and data succeed or roll back
together; this module opens no transaction of its own.
"""

from __future__ import annotations

from datetime import date

from django.db.models.functions import TruncDate
from django.utils import timezone

from allocation.validity import business_tz, civil_date
from allocation.windows import AssignmentWindows
from metering.models import ImportSource
from zev.models import MeteringPoint, Participant

from .models import Invoice, InvoiceReadingImpact, InvoiceReadingImpactResolution, InvoiceStatus

SOURCE_SDAT_IMPORT = "sdat-import"
SOURCE_CSV_IMPORT = "csv-import"
SOURCE_IMPORT_DELETION = "import-deletion"


def affected_participant_days(*, zev, slots: list[tuple]) -> dict[date, set]:
    """Active participants plus historical holders on each affected civil day.

    Legacy assignment windows can name a holder outside participant validity;
    retain that holder even when the active-participant set omits them.
    """
    if not slots:
        return {}
    point_ids = set(MeteringPoint.objects.filter(zev=zev, pk__in={slot[0] for slot in slots}).values_list("pk", flat=True))
    slots = [slot for slot in slots if slot[0] in point_ids]
    if not slots:
        return {}
    days = sorted({day for _mp_id, day, _direction in slots})
    windows = AssignmentWindows.for_zev(zev, days[0], days[-1])
    participants = list(
        Participant.objects.filter(zev=zev).values_list("id", "valid_from", "valid_to")
    )
    active_by_day = {
        day: {
            pid for pid, valid_from, valid_to in participants
            if valid_from <= day and (valid_to is None or valid_to >= day)
        }
        for day in days
    }
    targets: dict[date, set] = {}
    for mp_id, day, _direction in slots:
        holder_id = windows.participant_on(mp_id, day)
        day_targets = targets.setdefault(day, set())
        if holder_id is not None:
            day_targets.add(holder_id)
        day_targets.update(active_by_day.get(day, set()))
    return targets


def _invoices_for_targets(zev, targets: dict[date, set]):
    if not targets:
        return []
    days = sorted(targets)
    wanted = set().union(*targets.values())
    if not wanted:
        return []
    invoices = list(
        Invoice.objects.filter(
            zev=zev,
            participant_id__in=wanted,
            period_start__lte=days[-1],
            period_end__gte=days[0],
        )
        .exclude(status=InvoiceStatus.CANCELLED)
        .order_by("pk").select_for_update()
        .only("id", "participant_id", "period_start", "period_end")
    )
    hits = []
    for invoice in invoices:
        for day in days:
            if (
                invoice.participant_id in targets[day]
                and invoice.period_start <= day <= invoice.period_end
            ):
                hits.append(invoice)
                break
    return hits


def _create_impacts(*, invoices, import_log, evidence) -> int:
    if not invoices:
        return 0
    if import_log is not None:
        existing = set(
            InvoiceReadingImpact.objects.filter(
                invoice__in=invoices, import_log=import_log
            ).values_list("invoice_id", flat=True)
        )
        rows = [
            InvoiceReadingImpact(invoice=invoice, import_log=import_log, evidence=evidence)
            for invoice in invoices
            if invoice.id not in existing
        ]
    else:
        # Separate deletions can share a batch (or have none); retries find no readings.
        rows = [InvoiceReadingImpact(invoice=invoice, evidence=evidence) for invoice in invoices]
    InvoiceReadingImpact.objects.bulk_create(rows)
    return len(rows)


def flag_import_impacts(
    *,
    zev,
    import_log,
    changes_truncated,
    delivery,
    affected_slots,
) -> int:
    """Flag from complete per-meter/day/direction quantity-change counters.

    The persisted evidence list may be capped; this scope always covers all
    committed availability/value changes, with no metadata-only entries.
    """
    targets = affected_participant_days(zev=zev, slots=list(affected_slots))
    invoices = _invoices_for_targets(zev, targets)
    if not invoices:
        return 0
    days = sorted(targets)
    is_csv = import_log.source == ImportSource.CSV
    evidence = {
        "source": SOURCE_CSV_IMPORT if is_csv else SOURCE_SDAT_IMPORT,
        "change_count": sum(sum(counts.values()) for counts in affected_slots.values()),
        "kinds": sorted({kind for counts in affected_slots.values() for kind in counts}),
        "day_from": days[0].isoformat(),
        "day_to": days[-1].isoformat(),
        "changes_truncated": bool(changes_truncated),
    }
    if is_csv:
        evidence["filename"] = import_log.filename
    else:
        evidence.update({key: (delivery or {}).get(key, "")
                         for key in ("delivery_id", "creation", "status", "reason")})
    return _create_impacts(invoices=invoices, import_log=import_log, evidence=evidence)


def flag_deleted_slot_impacts(*, zev, readings, batch_ids) -> int:
    """Flag from the complete, scoped billable queryset before deleting it."""
    readings = readings.filter(metering_point__zev=zev)
    slots = list(readings.annotate(day=TruncDate("timestamp", tzinfo=business_tz()))
                 .order_by().values_list("metering_point_id", "day", "direction").distinct())
    targets = affected_participant_days(zev=zev, slots=slots)
    invoices = _invoices_for_targets(zev, targets)
    if not invoices:
        return 0
    days = sorted(targets)
    evidence = {
        "source": SOURCE_IMPORT_DELETION,
        "deleted_batches": sorted(str(batch_id) for batch_id in batch_ids),
        "deleted_readings": readings.count(),
        "day_from": days[0].isoformat(),
        "day_to": days[-1].isoformat(),
    }
    return _create_impacts(invoices=invoices, import_log=None, evidence=evidence)


def flag_reanchored_slot_impacts(*, zev, readings, new_timestamps):
    """Flag both sides of a legacy CSV timestamp correction before moving rows."""
    rows = list(readings.filter(metering_point__zev=zev).values_list(
        "pk", "metering_point_id", "timestamp", "direction",
    ))
    slots = set()
    for pk, point_id, old, direction in rows:
        slots.add((point_id, civil_date(old), direction))
        if pk in new_timestamps:
            slots.add((point_id, civil_date(new_timestamps[pk]), direction))
    targets = affected_participant_days(zev=zev, slots=list(slots))
    if not targets:
        return 0
    return _create_impacts(
        invoices=_invoices_for_targets(zev, targets), import_log=None,
        evidence={"source": "csv-reanchor", "changed_readings": len(rows),
                  "day_from": min(targets).isoformat(), "day_to": max(targets).isoformat()},
    )


def settle_regeneration(*, zev, doomed_invoice_ids, new_invoice) -> int:
    """Settle corrections incorporated under the billing lock after successful pricing."""
    from audit.models import AuditActionCategory
    from audit.services import MAX_AUDIT_LIST_ITEMS, record_audit_event

    if not doomed_invoice_ids:
        return 0
    open_impacts = list(InvoiceReadingImpact.objects.filter(
        invoice_id__in=doomed_invoice_ids, resolved_at__isnull=True,
    ).values("invoice_id", "invoice__invoice_number", "import_log_id", "evidence"))
    Invoice.objects.filter(pk__in=doomed_invoice_ids).delete()
    if open_impacts:
        record_audit_event(
            action_category=AuditActionCategory.INVOICE,
            action_type="invoice.reading_impact_resolved",
            target_type="invoices.Invoice", target=new_invoice,
            target_id=str(new_invoice.pk), target_display=new_invoice.invoice_number,
            summary=f"Regeneration of {new_invoice.invoice_number} incorporated {len(open_impacts)} reading correction(s).",
            zev=zev,
            metadata={
                "resolution": InvoiceReadingImpactResolution.REGENERATED,
                "incorporated": len(open_impacts),
                "previous_impacts": [
                    {"invoice_id": str(row["invoice_id"]),
                     "invoice_number": row["invoice__invoice_number"],
                     "evidence": row["evidence"]}
                    for row in open_impacts[:MAX_AUDIT_LIST_ITEMS]
                ],
                "previous_impacts_truncated": len(open_impacts) > MAX_AUDIT_LIST_ITEMS,
                "import_log_ids": sorted({str(row["import_log_id"]) for row in open_impacts if row["import_log_id"]}),
            },
        )
    return len(open_impacts)


def resolve_on_cancel(*, invoice) -> int:
    """Resolve open impacts when their invoice leaves through cancellation."""
    return InvoiceReadingImpact.objects.filter(
        invoice=invoice, resolved_at__isnull=True
    ).update(
        resolved_at=timezone.now(),
        resolution=InvoiceReadingImpactResolution.CANCELLED,
    )
