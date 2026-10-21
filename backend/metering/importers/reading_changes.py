"""Shared SDAT/CSV change auditing (invoice-lifecycle spec §4.6).

Both importers record their committed billable-slot changes in one shape: a
capped ``reading_changes`` evidence list plus an uncapped counter of
availability/value changes per meter, Swiss civil day and direction, so
invoice attribution stays complete when the list truncates.
"""

from collections import Counter

from allocation.validity import civil_date

from metering.models import ReadingChangeKind

READING_CHANGE_CAP = 10_000


class ReadingChangeRecorder:
    """Accumulates one import's committed slot changes.

    ``affected_slots`` never truncates (attribution scope); ``changes`` stops
    growing at ``cap``; ``truncated`` marks omitted detail.
    """

    def __init__(self, *, cap: int = READING_CHANGE_CAP):
        self.cap = cap
        self.changes: list[dict] = []
        self.affected_slots: dict = {}
        self.truncated = False

    def record(
        self,
        *,
        metering_point,
        timestamp,
        direction,
        kind,
        old=None,
        new,
        promoted=False,
        source_document_id="",
    ):
        if kind != ReadingChangeKind.METADATA:
            self.affected_slots.setdefault(
                (metering_point.pk, civil_date(timestamp), direction), Counter()
            )[kind] += 1
        if len(self.changes) >= self.cap:
            self.truncated = True
            return
        self.changes.append(
            {
                "metering_point": str(metering_point.pk),
                "meter_id": metering_point.meter_id,
                "timestamp": timestamp.isoformat(),
                "direction": direction,
                "kind": kind,
                "old_energy": str(old) if old is not None else None,
                "new_energy": str(new),
                "promoted": bool(promoted),
                "source_document_id": source_document_id,
            }
        )
