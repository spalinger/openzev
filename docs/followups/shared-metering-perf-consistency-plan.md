# Shared Metering Performance & Consistency — Implementation Plan

- Branch: `followup/shared-metering-perf-consistency` — base `feat/ui-print-parity`
- Companion note: `docs/followups/shared-metering-perf-consistency.md`
- Status: implemented 2026-08-25.
- All references below verified against the branch tip at planning time.

## Goal

Remove the per-invoice recomputation of community share denominators, and make reading
day-bucketing consistent between the billing engine and the allocation windows.

## Issue 1 — O(days × participants) denominators recomputed per invoice

**Corrected location** (the note pointed at `engine.py`; the function actually lives
in the allocation read model):
- `eligible_participant_shares` — `backend/allocation/read_model.py:56`. Callers:
  `backend/metering/analytics.py:77`, `backend/invoices/pdf_stats.py:109`,
  `backend/invoices/pdf_charts.py:557`, `backend/invoices/annual_statement.py`.
- The per-invoice fee denominators come from:
  - `weight_sums_for` closure — `backend/invoices/engine.py:809-816` (caches
    `weight_windows` via `nonlocal` *within one invoice*, recomputed per invoice),
  - `_count_active_participants_by_month` — `backend/invoices/engine.py:490`
    (fetches participant windows on every call).

**Problem:** for a 50-participant ZEV, the same community-wide work runs once per
invoice (×50). SQL query counts are pinned by tests; the Python duplication is not
cached across invoices.

**Plan:**
1. Hoist the shared work to the ZEV-period scope: in `generate_invoices_for_zev`
   (the batch entry point), compute participant weight windows and per-tariff monthly
   denominators once, and pass them into the per-participant invoice build as a small
   context object.
2. Prefer explicit parameter passing over `lru_cache` (ORM model instances and date
   ranges are awkward cache keys; explicit passing is testable and bounded).
3. Keep the single-invoice path correct: when invoicing one participant standalone,
   the same context is computed once for that run — behaviour must match the batch
   (the `_count_active_participants_by_month` docstring at `:490-506` documents this
   equivalence requirement; preserve it).

**Tests:** existing SQL query-count tests must pass without raising limits (ideally
the count drops — pin the new lower count). Add a runtime-shape test if cheap:
batch-generating N invoices calls the window fetch once (mock/spy).

## Issue 2 — `ts.date()` vs explicit UTC normalization

**Where:** `engine.py` reading loops use naive `ts.date()` (`:1017, :1023, :1034,
:1071, :1075, :1085, :1097, :1119, :1140, :1146` and a few more); the allocation layer
normalizes explicitly — `backend/allocation/windows.py:165`:
`day = ts.astimezone(timezone.utc).date()`. If a reading timestamp ever carries a
non-UTC tz, the two layers bucket readings onto different days — silently.

**Plan:**
1. Standardize: replace `ts.date()` in engine reading loops with
   `ts.astimezone(dt_timezone.utc).date()` (aliased import to avoid shadowing Django's
   `timezone`). ADR 0007 (timezone policy) governs — read it first and cite it in the
   change; if it mandates UTC-aware storage everywhere, add the precondition instead.
2. Do **not** widen scope: touch only reading-day derivation, not tariff date logic.

**Tests:** regression test feeding a non-UTC-aware timestamp (e.g. UTC+2) through the
day-bucketing path — result must equal the allocation layer's bucket for the same
instant. Plus the existing suite green.

## Validation

- `python -m pytest -q` (full suite: invoices, allocation, metering all touch this).
- Compare a batch run's invoice totals before/after on a demo ZEV (script or shell) —
  totals must be identical; only runtime/query counts should move.

## Spec/doc updates

- `docs/specs/2026-08-shared-metering-points.md`: denominator computation section —
  note the batch-scoped precompute.
- If the UTC change interprets ADR 0007, add a one-line note there (no new ADR needed).

## Risks & decisions

- Explicit context passing threads one more argument through invoice-build internals —
  accept the churn; memoization-by-global is the worse trade-off.
- If query-count tests assert *exact* counts, update the pinned numbers downward and
  explain in the PR.
