# SDAT-CH E66 import — release validation evidence

- Status: validation report for the integrated SDAT-CH stack (tasks A–E)
- Branch: `spalinger/SDAT-06-release-validation`, from `spalinger/SDAT-05-frontend-guide` @ `52e5f21b`
- Stack (bottom → top): `e908be93` importer rewrite, `8fa040a9` (A) meter identity,
  `8023f576` (B) strict E66/atomic revisions, `19ca0ae9` (C) deletion/v8 transfer,
  `56d99303` (D) invoice impact, `a59f5cf3` (E) frontend/guide, `52e5f21b` gap note + 07 follow-up
- Migrations: `zev` …`0044`, `0045`; `metering` `0008`, `0009`; `invoices` `0020` (linear chains, no conflicts)
- Related: [compatibility plan](2026-10-sdat-ch-compatibility-plan.md),
  [metering import and quality](2026-03-metering-import-and-quality.md) §4.2/§5.7,
  [invoice lifecycle](2026-03-invoice-lifecycle-and-communication.md) §3.3a/§4.6,
  [user guide](../user-guide/05-metering-import.md) (SDAT-CH Format chapter)

## 1. Release claim

Reliable manual E66 `ValidatedMeteredData` import for ZEV/vZEV billing.
The qualified supported profile is the matrix in
[2026-03-metering-import-and-quality](2026-03-metering-import-and-quality.md) §4.2
(mirrored operator-side in the user guide): E66 `ValidatedMeteredData_16`,
`E88`/`C38`, active energy `8716867000030` in KWH, IN/OUT, 15-minute complete
intervals, measured/estimated billable with `condition` retained, temporary held
in quarantine. Automated transport, ACK/error exchange, LEG settlement, other
market roles, general undo and source overrides are deferred — the guide states
this explicitly.

## 2. Conformance corpus

| Fixture | Provenance | Expected |
|---|---|---|
| `backend/metering/test_fixtures/sdatch/e66_1_4_4_customer.xml` | Unmodified copy of official VSE example `Beispiel_Messdatenaustauschprozesse_1_4_4_…_1p6.xml`; source archive https://www.strom.ch/de/media/13704/download; SHA-256 `02db4e971439d04ec9165162d2aa73202e0088ac8fb29da76fa8e91eb166558a` (verified against the working-tree file) | 190 billable / 2 held / 192 reactively-skipped; sums 14,060.102 kWh IN + 33,060.302 kWh OUT; canonical interval starts 2025-06-02 22:00Z–2025-06-03 21:45Z |
| Vendored XSD bundle `backend/metering/importers/sdat_xsd/` (54 files, offline `no_network=True`) | Copied unchanged from the official archive; directory README carries VSE/AES, ebIX, UNECE notices and the do-not-edit rule | Every accepted file validates; libxml2 `use="prohibited"` workaround applies to in-memory copies only |
| `e31_aggregated.xml` and all other `test_fixtures/sdatch/e66_*.xml` | Derived fixtures synthesized per rule (see module docstring of `test_import_sdatch_strict.py`) | Named rejection/hold behavior per issue code |

## 3. Results — passed

| Check | Command | Environment | Outcome |
|---|---|---|---|
| Backend lint | `ruff check .` (from `backend/`) | repo venv, Python 3.14.8 | passed |
| Django checks | `DEBUG=True python manage.py check` | same | passed (pre-existing `accounts.W001` MFA-keys warning only) |
| Migration graph | `DEBUG=True python manage.py makemigrations --check --dry-run` | same | no changes detected |
| Strict SDAT suite (sqlite) | `DEBUG=True python -m pytest metering/test_import_sdatch_strict.py -q -p no:cacheprovider -n 0` | sqlite test DB | 79 collected; exit 0 (75 pass, 4 PG-only skip) |
| Import/logs/timezone + invoice impact (sqlite) | `DEBUG=True python -m pytest metering/test_import_sdatch.py metering/test_import_logs.py metering/test_import_timezone.py invoices/test_reading_impact.py -q -p no:cacheprovider -n 4` | sqlite test DB | exit 0 |
| Strict + logs + impact (PostgreSQL) | `DATABASE_URL=postgres://openzev:openzev@localhost:5432/openzev DEBUG=True python -m pytest metering/test_import_sdatch_strict.py metering/test_import_logs.py invoices/test_reading_impact.py -q -p no:cacheprovider -n 0` | PostgreSQL 18 (container `postgres:18-alpine`, dev-stack server; Django `test_*` databases only) | 79 + 35 + 24 collected; exit 0, zero skips on the PG-gated classes |
| Transfer + backups (PostgreSQL) | `DATABASE_URL=… python -m pytest zev/test_transfer.py backups -q -p no:cacheprovider -n 0` | same PG server, `test_*` DBs | 665 collected (105 transfer + 560 backups); exit 0 |
| Full backend suite | `DEBUG=True python -m pytest -q -p no:cacheprovider -n 4` (from `backend/`) | sqlite test DB | exit 0: 4647 passed, 74 skipped, 2 xfailed, zero failed/error |
| Frontend lint | `npm run lint` (from `frontend/`) | Node v24.21.0 (matches `.node-version` 24.21.0) | passed |
| Frontend style | `npm run lint:style` | same | passed |
| Frontend color sweep | `node ../scripts/check-frontend-hex.mjs` | same | passed |
| Frontend units | `npm run test:unit` | same | 157 files / 2069 tests passed |
| Frontend build | `npm run build` | same | passed (existing large-chunk advisory only) |
| Docs build | `mkdocs build --strict` | mkdocs 1.6.1 (matches `requirements-docs.txt`; material version as installed) | passed |
| Issue-code audit | grep of all 42 `ISSUE_*` codes against `sdatch_importer.py` | working tree | each code defined once and emitted at exactly one site; every code has a spec-matrix entry (§6) |

PostgreSQL concurrency detail (all barrier/event-synchronized, no sleep races):
duplicate originals stay idempotent; older/newer replacements converge on the
newer `Creation` in both commit orders; equal-`Creation` conflicts accept exactly
one delivery and reject the other with both document identities; concurrent
promotion runs once; PG-only import-log isolation/row-lock tests pass; a failed
transaction never leaves data committed with a zero-count log.

Scale detail (synthetic E66 built with the repo's own `build_e66`/`build_block`
helpers; direct `import_sdatch` call; `CaptureQueriesContext` + wall time +
`tracemalloc` peak; throwaway benchmark file, removed after measurement):

| Delivery | Payload | Observations | Result | SQL queries | Elapsed | Python peak |
|---|---|---|---|---|---|---|
| Monthly, 10 meters (sqlite) | 3.8 MB | 28,800 | accepted | 328 | 20.4 s | 111.5 MB |
| Annual, 1 meter (sqlite) | 4.6 MB | 35,040 | accepted | 328→375 | 42.5 s | 123.1 MB |
| Monthly, 10 meters (PostgreSQL 18, `test_*` DB) | 3.8 MB | 28,800 | accepted | 328 | 16.1 s | 71.8 MB |
| Annual, 1 meter (PostgreSQL 18, `test_*` DB) | 4.6 MB | 35,040 | accepted | 375 | 21.7 s | 86.0 MB |

Query counts are flat per observation batch (batched reads/writes, single
stored-row load with `select_for_update`); no demonstrated bottleneck, so no
optimization was made. An independent re-run during integration validation
(throwaway probe reusing the repo's `build_e66`/`quarter_block` helpers,
removed afterwards) reproduced the figures within run-to-run tolerance:
sqlite monthly 328 queries / 17.5 s / 106.5 MB, sqlite annual 376 queries /
21.3 s / 117.5 MB, PG monthly 328 queries / 19.4 s / 69.3 MB. Upload/profile limits are unchanged and explicit:
50 MB upload (`MAX_SDAT_BYTES`), 100 MB decompressed (`MAX_SDAT_DECOMPRESSED_BYTES`),
enforced on actual bytes, not only size hints. Extrapolating the measured
~5–8 obs/ms to a full 50 MB delivery implies multi-minute synchronous uploads;
that regime was not measured and remains an open finding, not a claimed limit.

## 4. Results — skipped

- Browser viewport (~400 px + normal) and console check against the running dev
  stack: the reachable stack (`metering-points-followup-*` containers) has no
  demo credentials (`auth/token/` returns "No active account") and belongs to a
  different workstream — seeding or mutating its database was out of scope.
  No application (frontend/backend) change was made during integration, so the
  rendered UI is byte-identical to E's state; component rendering of every new
  outcome is covered by `frontend/tests/` (`import-protocol-sdat`,
  `imports-sdat-batch`, `sdat-outcome`, `invoice-data-review*`,
  `metering-point-secondary-id`, locale parity, dead-key guard).
- `spec-validate` skill: not present in this environment; the field-by-field
  validation (§6) was performed manually against code.

## 5. Pending — external gates (block production-readiness claims, nothing else)

- Real DSO-file acceptance: no partner files available. The concrete local
  acceptance checklist is §7; status PENDING.
- Automated transport / ACK-error / LEG / all-role claims remain deferred by
  policy (plan decisions Q1–Q12); no evidence is claimed for them.

## 6. Spec-vs-code validation (manual field-by-field pass)

- Import result contract (`result_status`, `result_counts` identity
  `rows_total == created+overwritten+held+duplicate+stale+excluded`,
  `promoted` informational-only, `quarantine_overwritten`, `reading_changes`
  availability/value/metadata, issue codes + severities): all 42 emitted
  codes verified at their single emission site each, and every code now has
  a §4.2 matrix entry (13 file/delivery/info codes were added to the matrix
  by this validation task); accounting identity asserted in
  `OfficialCustomerAcceptanceTests` (3 tests green).
- Deletion (§5.7): `protection_code` reads `rows_overwritten` /
  `result_counts.quarantine_overwritten`, malformed counters protect;
  `OVERWRITE_PROTECTED` / `QUARANTINE_REPLACE_PROTECTED` codes, 400 bulk
  all-or-nothing semantics, both-stream delete, `deletable` /
  `deletion_protection_code` serializer fields, `deleted_logs` /
  `deleted_readings` / `deleted_quarantined_readings` /
  `deleted_slots_truncated` responses, 500-slot evidence cap — all match code
  and `frontend/src/types/api.ts`.
- Invoice impact (§3.3a/§4.6 + D contract): `InvoiceReadingImpact` model,
  `flag_import_impacts` / `flag_deleted_slot_impacts` / `settle_regeneration` /
  `resolve_on_cancel`, `needs_data_review` / `open_data_impact_count` /
  `data_impacts` serializer fields, readiness + period-overview surfacing —
  present and tested (24 impact tests green on sqlite and PostgreSQL).
- Transfer v8: `FORMAT_VERSION = 8`, quarantine members under `quarantine/`,
  old-format restore with documented defaults, new-format rejection by old
  code (`check_format_version`) — present in schema/export/importer.
- Identity (A): cross-column validation with shared path for API and archive
  restore; importer-side ambiguity rejection independent of dictionary order.
- Known gap carried forward intentionally (not drift): CSV `overwrite_existing`
  emits no per-slot change evidence, so billed-slot overwrites raise no
  data-review flag; spec §5.2 notes the manual-verification workaround and
  handoff 07 scopes the follow-up. No code change was made for it here.
- Changes made by this validation task: §4.2 TEMP reference replaced with
  durable VSE source links; supported-profile matrix with issue-code mapping
  and corpus/checksum record added to §4.2, then extended so all 42 emitted
  codes are mapped (this section).

## 7. Local acceptance checklist for real DSO files (PENDING partner evidence)

1. Obtain one anonymized delivery per advertised profile (E88 daily/monthly
   active IN/OUT; one C38 information file; one correction chain with
   Status 5 + newer `Creation`) from at least two DSOs, with permission.
2. Record filename, byte size, gzip size, source and SHA-256 in §2 before import.
3. Import each through the wizard against a scratch ZEV whose meters carry the
   DSO's `VSENationalID`s (primary or secondary); confirm accepted/held
   outcomes and reconcile every observation against the DSO's totals.
4. Replay each file byte-identically (expect `unchanged`, zero writes);
   apply each correction chain (expect newer-wins, stale skips, invoice flags
   on billed periods).
5. Exercise one DST-transition delivery (92/100-slot day) and one month/year
   boundary delivery; confirm canonical timestamps and billing attribution.
6. Confirm a 312/313-shaped or otherwise out-of-profile file the DSO also
   sends is rejected or held with a named outcome and zero billing writes.
7. Only then extend the release claim beyond "qualified E66 file import".

## 8. Reference cleanup

- `docs/specs/sdat-ch-official-TEMP/` (172 tracked files, 12 MB, incl.
  `sdat_examples.zip`) removed from the working tree after confirming:
  permanent XSD bundle + notices, permanent 1_4_4 fixture + SHA-256 + source
  URL, durable strom.ch source links in §4.2, and zero code/test/docs
  dependencies on TEMP paths (only the untracked handoff README still names
  it, intentionally left untouched).
- Git history is NOT rewritten: the old temp commit `8dec109e` remains in the
  branch lineage. If the merge strategy requires it, squash-merge or drop that
  commit at merge time; reported here separately as instructed, not done here.

## 9. Open findings

1. CSV overwrite invoice-flag gap (known, → task 07): unflagged corrections
   possible via CSV overwrite; workaround documented in spec §5.2.
2. 50 MB-regime uploads unmeasured: supported limits are explicit, but only
   ~5 MB deliveries were benchmarked; treat very large deliveries as
   operationally unproven.
3. No browser viewport/console evidence in this pass (§4 skipped, reason given);
   E's UI is unchanged by integration, but a seeded-stack screenshot pass is
   still the cheapest way to close it.
4. Partner DSO acceptance pending (§7) — the single gate for any
   production-readiness claim.
5. History still contains temp commit `8dec109e` (§8).

## 10. Two-axis review

`code-review` sub-agent spawning is unavailable in this environment, so both
axes were executed inline by the integration validator against the final
working-tree diff (`52e5f21b` lineage plus the uncommitted F changes:
spec-matrix rows, TEMP-tree removal, this report). `pr-review` was not
claimed.

### Standards

- No application code was changed by this validation task (only spec prose
  and reference-tree removal), so no lint/style/i18n surface was added.
  Backend `ruff`, frontend ESLint/stylelint/hex sweep and both builds pass
  on the integrated tree.
- Spec-maintenance rules (AGENTS.md): only the affected §4.2 matrix rows
  were touched; every added mapping was verified against the emission site
  in `sdatch_importer.py` before writing. Comments/labels: no internal task
  labels leak into committed prose.
- Required vendored notices retained: `backend/metering/importers/sdat_xsd/`
  keeps its README with VSE/AES, ebIX and UNECE notices; the TEMP removal
  deletes only the working-copy reference tree, not the permanent bundle.
- One hygiene note: the pre-existing temp commit `8dec109e` stays in history
  (§8); no history rewrite was performed.

### Spec

- All 12 plan decisions (Q1–Q12) trace to code and tests: explicit E66-only
  profile, atomic file rejection, estimated-billable/temporary-held quality
  routing, independent stream freshness, invoice-impact flags with explicit
  regeneration, complete-position requirement, equal-Creation conflict
  rejection, deletion protection on both streams, v8 quarantine-preserving
  transfer, CSV/manual overlap rejection. Verified via the §6 contract pass
  and the green suites above.
- Corrections made during validation: issue-code count 22 → 42 with full
  matrix coverage; backup-test count 525 → 560 (665 total with transfer).
- Remaining spec-level gaps are the carried-forward known items, not drift:
  the CSV-overwrite invoice-flag gap (→ task 07, workaround in §5.2),
  unmeasured 50 MB-regime uploads, and pending partner DSO acceptance (§7).

One-line summary: Standards — no violations in F's diff, hygiene note only;
Spec — 12/12 decisions evidenced, two count corrections applied, remaining
gaps are the documented known/pending items.
