# ADR 0042: Serialize meter identities and protect historical reading configuration

- Status: Accepted
- Date: 2026-10-18
- Related: ADR 0038, ADR 0041

## Context

Primary and secondary IDs are unique separately, but a primary/secondary
collision across different points has no ordinary database unique constraint.
Pre-save validation can race. Imports must also use a current, compatible point
mapping rather than a cached identity whose type or community changed.
Generic reading CRUD and admin edits bypass correction provenance and impact
tracking. Silent historical type/community changes alter billing eligibility.

## Decision

- Model saves take the instance-wide identity transaction lock (namespace
  1641413, key 0), then the existing point row lock, revalidate persisted IDs
  and save. API PATCH refreshes its instance and reruns dependent validation while locked. Admin form POSTs,
  demo upserts and live community restore follow this order too; restore takes
  identity before its ZEV row lock and validates raw-restored identities.
- SDAT/CSV commits protect the ZEV row with key-share, then take their billing
  lock before point row locks. SDAT resolves
  identities and validates configured direction inside that transaction. Imports
  do not take the global identity lock, so unrelated communities can import
  concurrently. Point writers must not acquire billing locks after holding a
  point lock.
- A point with billable, held or supplementary history or a supplementary source cannot change type/community or be deleted. Rehoming also refuses assignment history and validates the effective destination building. Point deletion takes the identity lock before its point lock.
  Imports hold point locks through reading commit, so a concurrent edit
  either wins before resolution or sees history and is refused. Whole-community
  removal/restoration retains its separate administrative semantics.
- Generic reading API/admin routes are read-only. Supported quantity changes
  use imports or protected deletion; the legacy CSV timestamp-repair command
  follows ADR 0041 and flags both old and new civil dates. Sample generators are
  development-only.
- Raw SQL, QuerySet updates and bulk identity writes bypass model validation.
  They are reserved for explicit migration/restore protocols; normal callers use
  saves. PostgreSQL tests, not SQLite tests, establish the lock guarantees.

## Consequences

The identity lock serializes identity writes instance-wide without serializing
unrelated reading imports. It can remain held for a whole setup/archive/restore
transaction; those operations favor integrity over identity-edit throughput.
Per-column uniqueness and the self-inequality CHECK remain database safeguards.
Historical configuration is intentionally protected rather than implementing a
new generic correction service. Dated assignments and soft deactivation remain
available without erasing readings.

## Alternatives considered

- Calling full_clean alone leaves the validate/validate/save/save race open.
- A per-community identity lock cannot enforce a global identity rule.
- A normalized identity table would provide stronger database enforcement but
  requires a larger migration and all writers to change their storage contract.
- Leaving generic mutation routes writable would require a complete manual
  correction/provenance service that the product currently does not expose.
