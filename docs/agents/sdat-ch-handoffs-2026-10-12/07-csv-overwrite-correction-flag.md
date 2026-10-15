# 07 — Flag invoice impact of CSV overwrites (follow-up, post-release)

This task is outside the first SDAT-CH release. It closes the known gap
recorded in the metering import spec (§5.2, "Known gap"): CSV
`overwrite_existing` upserts slots without emitting per-slot change
evidence, so overwriting billed readings raises no invoice data-review
flag, while SDAT replacements do (via `reading_changes`).

## Outcome

A CSV overwrite of billing-relevant readings produces the same actionable,
scoped invoice-impact flag as an SDAT correction. No new invoice lifecycle
behavior; resolution reuses the existing regenerate/cancel workflows.

## Inspect first

- `backend/metering/importers/csv_importer.py`: overwrite upsert path and
  existing overwrite warning/count.
- `backend/invoices/reading_impact.py`: `flag_import_impacts()` and the
  `reading_changes` entry shape it consumes.
- `backend/metering/deletion.py`: `collect_deleted_slots()` (cap pattern).
- Task D completion report (persistence/API contracts) and the invoice
  lifecycle spec §4.6.

## Required behavior

1. Emit per-slot overwrite changes from the CSV importer in the same shape
   as SDAT `reading_changes` (availability/value kinds; cap volume like the
   existing evidence caps), inside the same transaction as the import.
2. Reuse `flag_import_impacts()` unchanged; replays/skips must not flag.
   Preserve existing CSV warnings, counts and idempotency.
3. Add regression tests: billed-slot overwrite flags the invoice; skip-mode
   duplicates and identical re-imports flag nothing; rolled-back CSV files
   flag nothing.
4. Update the metering import spec (remove the known-gap note) and the
   invoice lifecycle spec §4.6.

## Ownership

Own the CSV importer change, its tests and the spec updates above. Do not
alter SDAT revision logic, deletion code or invoice lifecycle rules.

## Completion

Run the CSV import, invoice/readiness and allocation suites plus backend
required checks (ruff, `manage.py check`, `makemigrations --check`).
Report validation commands and outcomes; state explicitly whether the
PostgreSQL leg was used.
