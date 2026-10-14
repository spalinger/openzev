"""Invoice impact of committed billing-input changes.

A committed SDAT-CH correction (or an import deletion) never rewrites an
invoice; it records one :class:`InvoiceReadingImpact` row per affected
invoice instead. Callers run inside their own transaction — the importer
commit block, the deletion block — so flags and data succeed or roll back
together; this module opens no transaction of its own.
"""

from __future__ import annotations

from datetime import date, datetime, timezone as dt_timezone
from uuid import UUID

from django.db import models
from django.utils import timezone

from allocation.validity import civil_date
from allocation.windows import AssignmentWindows
from metering.models import ReadingChangeKind
from zev.models import AllocationMode, Participant

from .models import Invoice, InvoiceReadingImpact, InvoiceReadingImpactResolution, InvoiceStatus

SOURCE_SDAT_IMPORT = "sdat-import"
SOURCE_IMPORT_DELETION = "import-deletion"

# Only quantity changes can outdated an invoice. A metadata-only change
# (same energy, new provenance) leaves every total untouched.
FLAG_KINDS = frozenset({ReadingChangeKind.AVAILABILITY, ReadingChangeKind.VALUE})


def _change_day(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        ts = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=dt_timezone.utc)
    return civil_date(ts)


def _holder_and_mode(windows: AssignmentWindows, metering_point_id, day: date):
    for valid_from, valid_to, participant_id, mode, _assignment_id in windows.active_windows(
        metering_point_id
    ):
        if valid_from <= day and (valid_to is None or valid_to >= day):
            return participant_id, mode
    return None, None


def _target_participants(*, zev, slots: list[tuple]) -> dict[date, set]:
    """Map each affected civil day to the participant ids whose invoices it taints.

    ``slots`` are ``(metering_point_id, day, direction)``. The holder on the
    reading's own day is always flagged — including a past holder, never just
    the meter's current one. Production and community-allocated slots spread
    through the shared pool, so every participant active that day is flagged.
    """
    if not slots:
        return {}
    days = sorted({day for _mp_id, day, _direction in slots})
    windows = AssignmentWindows.for_zev(zev, days[0], days[-1])
    from zev.models import PARTY_NAME_FIELDS

    participants = {
        p.id: (p.valid_from, p.valid_to)
        for p in Participant.objects.filter(zev=zev).only(
            "id", "valid_from", "valid_to", "party",
            *(f"party__{name}" for name in PARTY_NAME_FIELDS),
        )
    }
    targets: dict[date, set] = {}
    for mp_id, day, direction in slots:
        holder_id, mode = _holder_and_mode(windows, mp_id, day)
        day_targets = targets.setdefault(day, set())
        if holder_id is not None:
            day_targets.add(holder_id)
        if direction == "out" or mode == AllocationMode.COMMUNITY:
            day_targets.update(
                pid
                for pid, (valid_from, valid_to) in participants.items()
                if valid_from <= day and (valid_to is None or valid_to >= day)
            )
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
        # NULL import logs never match a uniqueness lookup; dedupe against the
        # same deletion batch set in Python instead. Deletions are rare, so the
        # per-invoice query stays cheap.
        rows = []
        for invoice in invoices:
            same = InvoiceReadingImpact.objects.filter(
                invoice=invoice, import_log__isnull=True, resolved_at__isnull=True
            ).only("id", "evidence")
            if any(
                (row.evidence or {}).get("deleted_batches") == evidence.get("deleted_batches")
                for row in same
            ):
                continue
            rows.append(InvoiceReadingImpact(invoice=invoice, import_log=None, evidence=evidence))
    InvoiceReadingImpact.objects.bulk_create(rows)
    return len(rows)


def flag_import_impacts(*, zev, import_log, changes, changes_truncated, delivery) -> int:
    """Flag invoices outdated by one committed SDAT-CH import.

    Consumes ``ImportLog.reading_changes``: availability/value entries flag,
    metadata-only ones do not, and an empty change list (replays, stale
    skips, held-only files, rolled-back imports) flags nothing.
    """
    actionable = [entry for entry in changes if entry.get("kind") in FLAG_KINDS]
    if not actionable:
        return 0
    slots = []
    for entry in actionable:
        day = _change_day(entry.get("timestamp"))
        if day is None:
            continue
        try:
            mp_id = UUID(str(entry.get("metering_point")))
        except (ValueError, AttributeError, TypeError):
            continue
        slots.append((mp_id, day, entry.get("direction")))
    targets = _target_participants(zev=zev, slots=slots)
    invoices = _invoices_for_targets(zev, targets)
    if not invoices:
        return 0
    days = sorted(targets)
    evidence = {
        "source": SOURCE_SDAT_IMPORT,
        "delivery_id": (delivery or {}).get("delivery_id", ""),
        "creation": (delivery or {}).get("creation", ""),
        "status": (delivery or {}).get("status", ""),
        "reason": (delivery or {}).get("reason", ""),
        "change_count": len(actionable),
        "kinds": sorted({entry.get("kind") for entry in actionable}),
        "day_from": days[0].isoformat(),
        "day_to": days[-1].isoformat(),
        "changes_truncated": bool(changes_truncated),
    }
    return _create_impacts(invoices=invoices, import_log=import_log, evidence=evidence)


def flag_deleted_slot_impacts(*, zev, slots, slots_truncated, batch_ids) -> int:
    """Flag invoices left stale by an additive-import deletion.

    Only billable deletions taint invoices; held-only evidence never billed
    anything. ``slots`` are C's ``collect_deleted_slots`` entries.
    """
    billable = [slot for slot in slots if slot.get("stream") == "billable"]
    if not billable:
        return 0
    parsed = []
    for slot in billable:
        day = _change_day(slot.get("timestamp"))
        if day is None:
            continue
        try:
            mp_id = UUID(str(slot.get("metering_point")))
        except (ValueError, AttributeError, TypeError):
            continue
        parsed.append((mp_id, day, slot.get("direction")))
    targets = _target_participants(zev=zev, slots=parsed)
    invoices = _invoices_for_targets(zev, targets)
    if not invoices:
        return 0
    days = sorted(targets)
    evidence = {
        "source": SOURCE_IMPORT_DELETION,
        "deleted_batches": [str(batch_id) for batch_id in batch_ids],
        "deleted_readings": len(billable),
        "day_from": days[0].isoformat(),
        "day_to": days[-1].isoformat(),
        "slots_truncated": bool(slots_truncated),
    }
    return _create_impacts(invoices=invoices, import_log=None, evidence=evidence)


def settle_regeneration(*, zev, doomed_invoice_ids, new_invoice, since) -> tuple[int, int]:
    """Settle open impacts after a successful explicit regeneration.

    Runs inside the generation transaction, after the new invoice exists but
    before the replaced drafts are deleted: impacts from corrections the new
    invoice incorporated (created no later than generation started) die with
    their draft, while a correction that landed mid-regeneration moves to the
    new invoice instead of vanishing with the old one. Only call on success:
    a failed regeneration incorporates nothing and keeps its drafts.
    """
    from audit.models import AuditActionCategory
    from audit.services import record_audit_event

    if not doomed_invoice_ids:
        return 0, 0
    open_impacts = list(
        InvoiceReadingImpact.objects.filter(
            invoice_id__in=doomed_invoice_ids, resolved_at__isnull=True
        ).only("id", "import_log_id", "created_at")
    )
    if not open_impacts:
        Invoice.objects.filter(pk__in=doomed_invoice_ids).delete()
        return 0, 0
    later_ids = [row.pk for row in open_impacts if row.created_at > since]
    incorporated = [row for row in open_impacts if row.created_at <= since]
    carried = 0
    if later_ids:
        carried = InvoiceReadingImpact.objects.filter(pk__in=later_ids).update(
            invoice=new_invoice
        )
    Invoice.objects.filter(pk__in=doomed_invoice_ids).delete()
    if incorporated or carried:
        record_audit_event(
            action_category=AuditActionCategory.INVOICE,
            action_type="invoice.reading_impact_resolved",
            target_type="invoices.Invoice",
            target=new_invoice,
            target_id=str(new_invoice.pk),
            target_display=new_invoice.invoice_number,
            summary=(
                f"Regeneration of {new_invoice.invoice_number} incorporated "
                f"{len(incorporated)} reading correction(s); {carried} later "
                "correction(s) carried to the new invoice."
            ),
            zev=zev,
            metadata={
                "resolution": InvoiceReadingImpactResolution.REGENERATED,
                "incorporated": len(incorporated),
                "carried": carried,
                "import_log_ids": sorted(
                    {str(row.import_log_id) for row in open_impacts if row.import_log_id}
                ),
            },
        )
    return len(incorporated), carried


def resolve_on_cancel(*, invoice) -> int:
    """Resolve open impacts when their invoice leaves through cancellation."""
    return InvoiceReadingImpact.objects.filter(
        invoice=invoice, resolved_at__isnull=True
    ).update(
        resolved_at=timezone.now(),
        resolution=InvoiceReadingImpactResolution.CANCELLED,
    )


def open_impacts_for(invoice):
    return (
        InvoiceReadingImpact.objects.filter(invoice=invoice, resolved_at__isnull=True)
        .select_related("import_log")
        .order_by("-created_at", "id")
    )


def has_open_impact(invoice) -> bool:
    return InvoiceReadingImpact.objects.filter(
        invoice_id=invoice.pk if isinstance(invoice, models.Model) else invoice,
        resolved_at__isnull=True,
    ).exists()
