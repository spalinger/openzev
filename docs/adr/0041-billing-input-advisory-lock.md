# ADR 0041: Serialize billing-input writes and generation with a per-ZEV advisory lock

- Status: Accepted
- Date: 2026-10-18

## Context

Imported corrections (SDAT-CH and CSV), import-log deletions and
metering-point deletions all commit billing-input changes inside their own
transaction, while single-invoice generation reads those inputs and prices a
new invoice. Running concurrently, two of the three can interleave: a
correction that commits after generation has priced billable slots still
flags the freshly generated invoice as outdated, and a deletion that lands
mid-generation removes readings the run is billing from. Both outcomes are
honest (the flag points at the committed truth), but the first flags an
invoice that was regenerated seconds later, and the second bills from a
partially deleted history.

Blocking on readings or participants as row locks would deadlock against
generation's lock order (ZEV key-share, participant, overlapping invoices,
numbering — ADR 0038) and would block unrelated readers of the same rows.

## Decision

`metering/locks.py::lock_billing_inputs(zev)` first protects the ZEV row with `FOR KEY SHARE`, then takes
`pg_advisory_xact_lock(1641412, zlib.crc32(str(zev.id)))` — one fixed class
keyed per community — inside the calling transaction. The participating call sites
take it at the start of their guarded block:

- the SDAT-CH importer's commit block,
- the CSV importer's commit block,
- import-log deletion (`metering.views` bulk delete),
- metering-point (reading) deletion,
- legacy CSV timestamp repair,
- single-invoice generation (after the ADR 0038 ZEV key-share and
  participant locks, before pricing work).

An advisory lock needs no table and releases at commit or rollback. All
participating operations must follow a compatible advisory- and row-lock order;
advisory locks can participate in deadlocks if that order is inverted. The
PostgreSQL-only call is a no-op on SQLite, which is supported for development/tests. MariaDB does not implement this lock protocol and is not supported for these workflows.

## Consequences

Import, deletion and generation serialize per community: a correction
waiting behind a generation flags the replacement invoice after it commits
(invoice-lifecycle spec §4.6), and generation never bills against a
half-applied import. Cached participant weights remain valid while each
invoice reloads its readings under the lock. Bulk generation deliberately
keeps independent participant transactions (throughput and per-participant
failure isolation); its interleaving window with imports is accepted because
flags stay truthful — the invoice either incorporated the correction or
carries the open flag. The class number is arbitrary but fixed; two
openzev installations share no keyspace.

## Alternatives considered

- Row-locking the read range would block unrelated participants and
  deadlocks with the invoice/numbering order generation already holds.
- A serialization table (one row per ZEV) would add a migrating-and-locking
  ceremony the advisory path avoids.
- Extending the lock to bulk generation would serialize a whole batch
  behind every import and forfeit per-participant failure isolation.

The legacy CSV timestamp-repair command follows import deletion's order
(sorted ZEV key-share protection, selected log rows, then sorted billing locks)
and replans before writing. Import deletion follows the same parent-before-child
order. This prevents live restore, which locks the ZEV exclusively before its
children, from deadlocking with deferred foreign-key checks at import commit.
Generic reading writes are closed; point history guards and commit-time point
locks are specified in ADR 0042. With these participating paths serialized,
regeneration settles incorporated impacts directly; no tracked correction can
commit halfway through pricing and require timestamp-based carry-forward.

Joined workflow queries are part of this order: paid-invoice correction locks
only its invoice (`select_for_update(of=("self",))`), leaving the joined ZEV
unlocked. Credit numbering uses `NO KEY UPDATE`, compatible with import KEY SHARE.

Assignment-window edits are outside this reading-correction protocol. They remain
a separate management operation; the reading-impact guarantee covers the listed
import/deletion/timestamp-repair writers, not all historical allocation changes.
