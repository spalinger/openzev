# Follow-up: Shared Metering Engine Bugs

Status: not yet started. File these as issues before merging the shared-metering feature.
Discovered during review of `feat/ui-redesign-pdf-style` (these bugs are in the shared-metering commits, not the UI redesign).

## 1. Fee double-billing in personal→community transition month

**File:** `backend/invoices/engine.py:384-394, 437-443, 844-870`

A metering point switching `PERSONAL` (Jan 1–15) → `COMMUNITY` (Jan 16+) overlaps both counts
in January: the holder pays the full per-meter fee personally **and** every member pays a weight
share of another full fee for the same meter-month.

The docstring at engine.py:406 claims "disjoint per month… exactly once" — this is false:
disjointness holds per window, not per meter-per-month. The mixed-window test pins energy
attribution but asserts nothing about fees.

**Fix:** In the transition month, prorate the personal fee to the PERSONAL days and the community
fee to the COMMUNITY days, or exclude the meter from one count.

## 2. CHF 0.00 "N Monate" invoice lines for near-zero-weight members

**File:** `backend/invoices/engine.py:893-919, :244`

The accumulator skips only `quantity == 0 AND total == 0`. A near-zero-weight member with
`shared_total` rounding to CHF 0.00 but `shared_months == 1` gets a line reading "1 month CHF 0.00",
which is semantically wrong (they owe nothing and shouldn't see a line item).

**Fix:** Also skip when `total.round(2) == 0`.

## 3. Community gap readings dropped silently

**File:** `backend/invoices/engine.py:1114-1118, 1166-1170 vs 1228-1240`

Personal loop: gap readings are counted and logged at WARNING level.
Community loop: `continue` with no counter or log — silently drops money-affecting data.

This is an auditability gap (no trace that readings were skipped).

**Fix:** Add gap counters and WARNING logs to the community loop, matching the personal loop.
