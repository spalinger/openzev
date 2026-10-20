# ADR 0043: Aggregate annual-report energy in SQL

- Status: Accepted
- Date: 2026-10-22
- Amends: [ADR 0013](0013-shared-allocation-service.md)

## Context

The annual report previously used the dashboard's Python allocation pass for
a full year. On the Proxmox/PostgreSQL demo benchmark at `c46f6cc7`, SQL
aggregation reduced the warm endpoint median from 1,231 ms to 144 ms for
61,320 yearly readings; final-revision timings have not been remeasured.

## Decision

Use `metering.annual_balance.year_energy` as a report-only SQL read model.
It nets energy per timestamp, attributes it by civil-day assignment and
community shares, and returns monthly and participant totals. The previous
year uses only monthly totals. Billing and dashboards retain the shared Python
allocation service; this is a deliberate exception to ADR 0013's single formula
implementation, not a change to its allocation rules.

## Consequences

Allocation changes must update both implementations. Keep differential tests
and independent expected-value cases for assignment/membership boundaries,
DST, whole-number division and net-metered flags. Reject overlapping assignment
windows before the SQL join. Positive weights remain a valid-input requirement
enforced by API/archive validation, not a new database invariant.

Reject any negative source reading in either report year with
`InvalidAllocationInputError`, preserving the allocation service's fail-fast
contract. Carry the minimum reading through the existing SQL aggregation so
positive readings cannot hide corrupt input in timestamp or monthly totals.

The query depends on persisted table/choice names and Django's backend SQL
hooks. Run the annual-report tests on SQLite and PostgreSQL when upgrading
Django or changing allocation/schema rules. The Django version is pinned.

## Alternatives considered

- Keep the Python pass: simpler ownership of the rules, but slower on yearly reads.
- Cache reports: requires invalidation for readings, assignments, memberships,
  weights and invoices. SQL aggregation improves uncached reads without that state.
