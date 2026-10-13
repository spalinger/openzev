"""Import-log deletion guards and evidence.

An import is deletable only when it added values without replacing prior
billable or held (quarantine) data. Replacement is read from persisted
counters — ``ImportLog.rows_overwritten`` for billable slots and
``result_counts.quarantine_overwritten`` for held slots — so protection
survives promotion and import-batch reassignment. See the metering import
and quality spec §5.7.
"""

DELETION_EVIDENCE_CAP = 500

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


def collect_deleted_slots(batch_ids, *, cap=DELETION_EVIDENCE_CAP):
    """Describe the readings a deletion is about to remove.

    Returns ``(slots, truncated)`` where each slot carries the metering
    point, meter id, timestamp, direction, energy and stream. Captured
    before the delete so invoice-impact consumers keep per-slot evidence
    after the rows are gone.
    """
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
        for row in rows.iterator():
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
