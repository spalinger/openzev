"""Serialize price writes with invoice reads and preserve billed intervals."""

from datetime import timezone
from bisect import bisect_left, bisect_right
from operator import itemgetter

from django.db import transaction
from django.db.models import Max, Min

from .evidence import billed_ranges, lock_sources
from .models import DynamicPricePoint, DynamicTariffSource
from .vse_v1 import DynamicTariffResponseError


class PriceSeriesConflict(ValueError):
    """Fetched prices cannot be safely stored."""


class BilledPriceChanged(PriceSeriesConflict):
    """An interval retained for an invoice would change."""


class PriceIntervalConflict(PriceSeriesConflict, DynamicTariffResponseError):
    """Incoming and stored intervals cannot form an unambiguous series."""


def _groups(rows):
    """Connected overlap groups in O(n log n), including replaced old rows."""
    group, end = [], None
    for row in sorted(rows):
        if end is not None and row[0] >= end:
            yield group
            group = []
        end = max(end, row[1]) if group else row[1]
        group.append(row)
    if group:
        yield group


def _replacement(group, billed):
    old = {row[0]: row[1:3] for row in group if not row[3]}
    incoming = [row[:3] for row in group if row[3]]
    if not incoming:
        return [], []
    for earlier, later in zip(incoming, incoming[1:]):
        if earlier[1] > later[0]:
            raise PriceIntervalConflict("The response contains overlapping price intervals.")
    changed = [row for row in incoming if old.get(row[0]) != row[1:]]
    if not changed:
        return [], []
    if _merge_equal_prices(sorted((start, *value) for start, value in old.items())) == _merge_equal_prices(incoming):
        # A provider may republish identical prices at another resolution.
        # Keep the original evidence rows and treat equivalent coverage as a no-op.
        return [], []

    incoming_set = set(incoming)
    coverage = []
    for start, end, _price in incoming:
        if coverage and coverage[-1][1] == start:
            coverage[-1] = (coverage[-1][0], end)
        else:
            coverage.append((start, end))
    coverage_starts = [start for start, _end in coverage]
    # Every old interval being displaced must be covered in full. This permits
    # an unbilled resolution change without clipping an operator's boundary.
    for start, (end, price) in old.items():
        if (start, end, price) in incoming_set:
            continue
        if _overlaps_billed(start, end, billed):
            raise BilledPriceChanged(
                f"Stored price {start.isoformat()} already priced an invoice and cannot be overwritten."
            )
        index = bisect_right(coverage_starts, start) - 1
        if index < 0 or coverage[index][1] < end:
            raise PriceIntervalConflict(
                f"Price interval {start.isoformat()} overlaps stored evidence without replacing it in full. "
                "Backfill the complete unbilled interval to adopt the new resolution."
            )
    for start, end, _price in changed:
        if old and _overlaps_billed(start, end, billed):
            raise BilledPriceChanged(
                f"Stored price {start.isoformat()} already priced an invoice and cannot be overwritten."
            )
    new_starts = {start for start, _end, _price in incoming}
    return changed, [start for start in old if start not in new_starts]


def _merge_equal_prices(rows):
    merged = []
    for start, end, price in rows:
        if merged and merged[-1][1] == start and merged[-1][2] == price:
            merged[-1] = (merged[-1][0], end, price)
        else:
            merged.append((start, end, price))
    return merged


def _overlaps_billed(start, end, billed):
    index = bisect_left(billed, end, key=itemgetter(0)) - 1
    return index >= 0 and billed[index][1] > start


def store_points(source, points):
    """Commit independent valid overlap groups; report conflicts afterwards.

    An enclosing caller transaction can still roll all writes back on refusal.
    See the dynamic tariff spec for evidence and resolution-change policy.
    """
    if not points:
        return 0
    incoming = sorted({
        (point.valid_from.astimezone(timezone.utc),
         point.valid_to.astimezone(timezone.utc), point.price_chf_per_kwh, True)
        for point in points
    })
    if any(end <= start for start, end, _price, _new in incoming):
        raise PriceIntervalConflict("Price intervals must have a positive duration.")
    conflicts, changed, removed = [], [], []
    with transaction.atomic():
        lock_sources([source.pk])
        old = list(DynamicPricePoint.objects.filter(
            source=source, valid_from__lt=max(row[1] for row in incoming),
            valid_to__gt=incoming[0][0],
        ).values_list("valid_from", "valid_to", "price_chf_per_kwh"))
        billed = billed_ranges(source)
        for group in _groups(incoming + [(*row, False) for row in old]):
            try:
                updates, deletions = _replacement(group, billed)
                changed.extend(updates)
                removed.extend(deletions)
            except PriceSeriesConflict as exc:
                conflicts.append(exc)
        if removed:
            source.points.filter(valid_from__in=removed).delete()
        if changed:
            DynamicPricePoint.objects.bulk_create([
                DynamicPricePoint(source=source, valid_from=start, valid_to=end, price_chf_per_kwh=price)
                for start, end, price in changed
            ], update_conflicts=True, unique_fields=["source", "valid_from"],
                update_fields=["valid_to", "price_chf_per_kwh"])
        extent = source.points.aggregate(first=Min("valid_from"), last=Max("valid_to"))
        DynamicTariffSource.objects.filter(pk=source.pk).update(
            covers_from=extent["first"], covers_to=extent["last"],
        )
    if conflicts:
        kind = type(conflicts[0]) if len({type(exc) for exc in conflicts}) == 1 else PriceSeriesConflict
        raise kind("; ".join(str(exc) for exc in conflicts[:3]))
    return len(changed)
