# Shared Metering Engine Bugs — Implementation Plan

- Branch: `followup/shared-metering-engine-bugs` — base `feat/ui-print-parity`
- Companion note: `docs/followups/shared-metering-engine-bugs.md`
- Status: plan drafted 2026-08-25; implementation not started.
- All references below verified against the branch tip at planning time (line numbers
  match `backend/invoices/engine.py` on this branch).

## Goal

Fix three billing-affecting bugs discovered during review of the shared-metering work.
These are in the shared-metering commits, not the UI redesign.

## Bug 1 — Fee double-billing in personal→community transition month

**Where:** `engine.py:384-394` (personal per-month metering-point count, PERSONAL mode),
community counterpart below it; docstring at `engine.py:404-409` claims the two counts
are "disjoint per month … exactly once" — false for a mid-month mode switch.

**Problem:** a metering point PERSONAL Jan 1–15 → COMMUNITY Jan 16+ is counted in
*both* counts for January: the holder pays a full personal per-meter fee **and** every
member pays a weight share of another full fee for the same meter-month. The existing
mixed-window test pins energy attribution but asserts nothing about fees.

**Plan:**
1. Reproduce first: extend the mixed-window test with fee assertions showing the
   double charge (this test becomes the regression test).
2. Decide proration rule (needs sign-off — money semantics): prorate by days —
   personal fee × (personal days / days in month), community fee × (community days /
   days in month) — so the meter-month is billed exactly once in total. Alternative:
   attribute the whole month to the mode covering the most days (simpler, less fair).
3. Implement in the two count helpers: month coverage becomes window-overlap days
   rather than a boolean "active this month", and the fee math multiplies by the day
   fraction. Both personal and community sides must change symmetrically.
4. Fix the docstring at `:404-409` — disjointness is per window-day, not per month.

**Tests:** transition-month fee total equals exactly one meter-month fee; pure-personal
and pure-community months unchanged; monthly/quarterly/annual periods each covered by
at least one assertion (reuse the existing `_billable_months` fixtures).

## Bug 2 — CHF 0.00 "N Monate" lines for near-zero-weight members

**Where:** shared-fee accumulator `engine.py:855-868` — emits a line whenever
`shared_months > 0`, even when `shared_total` rounds to CHF 0.00. The generic
accumulator skip `quantity == 0 and total == 0` (`engine.py:244`, `:934`) never sees
it because quantity (months) is non-zero.

**Plan:**
1. After the month loop, skip the line when `shared_total.quantize(Decimal("0.01")) == 0`.
2. Reconciliation check: the skipped amount is 0.00, so ZEV-wide totals must still tie
   out — assert in the test.

**Tests:** member with near-zero weight → no shared-fee line item; member with a
rounding-positive share keeps their line; totals unchanged before/after.

## Bug 3 — Community gap readings dropped silently

**Where:** community consumption loop `engine.py:1114-1119` and community production
loop `engine.py:1166-1172` — `continue` with no counter/log on gap readings. The
personal loop counts gaps and logs WARNING at `engine.py:1228-1240`.

**Plan:**
1. Add gap counters + kWh totals to both community loops, then WARNING-log in the same
   shape as the personal loop (participant, period, counts, kWh). Merge into the
   existing message or a parallel one — keep it greppable for ops.
2. No money semantics change; this is auditability only.

**Tests:** `caplog` assertion that a community-mode gap reading produces the WARNING
with correct counts; existing energy-attribution tests stay green.

## Validation

- `python -m pytest invoices -q`, then full `python -m pytest -q` (allocation and
  query-count suites are sensitive to engine changes).
- Query-count tests must not change — none of these fixes may add queries.

## Spec/doc updates

- `docs/specs/2026-08-shared-metering-points.md`: document the transition-month
  proration rule (Bug 1 changes documented behaviour — mandatory spec update), the
  zero-line skip (Bug 2), and community gap logging (Bug 3).

## Risks & decisions

- Bug 1 is the only one changing billed amounts — land it with its own commit and call
  out the proration decision in the PR; consider whether already-generated invoices
  need a data note (they shouldn't exist yet for shared metering, but verify).
- Order: Bug 3 first (pure observability), Bug 2 (trivial), Bug 1 (largest review).
