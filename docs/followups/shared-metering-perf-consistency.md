# Follow-up: Shared Metering Performance & Consistency

Status: not yet started.

## 1. O(days × participants²) in eligible_participant_shares

**File:** `backend/invoices/engine.py`

`eligible_participant_shares` is O(days × participants) in Python, re-run per participant per
invoice. For a ZEV with 50 participants and a monthly invoice (~30 days), this is ~1,500 tuple
comparisons; across all 50 invoices that's ~75,000 — and it's the same work 50 times.
SQL counts are pinned by tests; the CPU duplication isn't cached.

**Fix:** Precompute community-wide share map once per ZEV-period and pass it in, or memoize
with an LRU cache keyed on (zev_id, period_start, period_end).

## 2. ts.date() vs explicit UTC normalization inconsistency

**File:** `engine.py:1119, 1171` vs `windows.py:165`

`engine.py` uses `ts.date()` for community reading date keys (naive datetime, relies on DB
storing UTC). `windows.py` explicitly normalizes to UTC before calling `.date()`. If a reading
timestamp ever carries a non-UTC-aware datetime, these diverge silently.

**Fix:** Standardise on `ts.astimezone(dt_timezone.utc).date()` everywhere, or add a
precondition check that all timestamps are UTC-aware.
