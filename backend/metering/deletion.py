"""Import-log deletion guards and evidence.

An import is deletable only when it added values without replacing prior
billable or held (quarantine) data. Replacement is read from persisted
counters — ``ImportLog.rows_overwritten`` for billable slots and
``result_counts.quarantine_overwritten`` for held slots — so protection
survives promotion and import-batch reassignment. See the metering import
and quality spec §5.7.
"""

from audit.services import MAX_AUDIT_LIST_ITEMS

DELETION_EVIDENCE_CAP = MAX_AUDIT_LIST_ITEMS

OVERWRITE_PROTECTED = "overwrite_import_protected"
QUARANTINE_REPLACE_PROTECTED = "quarantine_replace_protected"


def protection_code(log):
    if log.rows_overwritten:
        return OVERWRITE_PROTECTED
    counts = log.result_counts
    held_replacements = counts.get("quarantine_overwritten", 0) if isinstance(counts, dict) else None
    # Unusable replacement evidence must not make an import deletable.
    if type(held_replacements) is not int or held_replacements != 0:
        return QUARANTINE_REPLACE_PROTECTED
    return None


def collect_deleted_slots(batch_ids, *, zev_id=None, cap=DELETION_EVIDENCE_CAP):
    """Capture bounded billable/held deletion evidence for audit metadata."""
    from .models import MeterReading, QuarantinedReading

    slots = []
    truncated = False
    for model, stream in ((MeterReading, "billable"), (QuarantinedReading, "held")):
        rows = (
            model.objects.filter(import_batch__in=batch_ids)
            .select_for_update(of=("self",))
            .order_by("metering_point_id", "timestamp", "direction")
            .values(
                "metering_point_id",
                "metering_point__meter_id",
                "timestamp",
                "direction",
                "energy_kwh",
            )
        )
        if zev_id is not None:
            rows = rows.filter(metering_point__zev_id=zev_id)
        for row in rows[:max(0, cap - len(slots)) + 1]:
            if len(slots) >= cap:
                truncated = True
                break
            slots.append(
                {
                    "metering_point": str(row["metering_point_id"]),
                    "meter_id": row["metering_point__meter_id"],
                    "timestamp": row["timestamp"].isoformat(),
                    "direction": row["direction"],
                    "energy_kwh": str(row["energy_kwh"]),
                    "stream": stream,
                }
            )
        if truncated:
            break
    return slots, truncated
