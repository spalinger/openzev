# Change Spec: SDAT capacity benchmark

- Spec ID: SPEC-2026-sdat-capacity-benchmark
- Status: Completed
- Scope: Minor
- Type: Change
- Owners: OpenZEV maintainers
- Created: 2026-10-28
- Related Issues: #956
- Impacted Areas: backend, docs

## 1. Problem and outcome

`benchmark_sdatch` measures synthetic imports using the real importer in fresh
Linux processes. It records failure evidence as well as successful persistence.
It does not change production import behavior, schemas, API contracts, frontend
or Celery tasks. Production-capacity acceptance additionally needs deployment
budgets, repeated trials and the deployed HTTP upload path.

## 2. Safety and setup

Use a separate PostgreSQL server, not an application development server. Both
parent and workers require PostgreSQL, a `sdat_benchmark_*` database, and
`--confirm-disposable` matching that database name. The connected role must use
that prefix, have no superuser/CREATEDB/CREATEROLE/replication/BYPASSRLS privileges,
no role memberships, and no CONNECT privilege on other application databases.
Templates, built-in `postgres`, and benchmark databases are exempt from the
CONNECT check. PostgreSQL grants CONNECT to PUBLIC by default: shared clusters
with other application databases will deliberately fail this check.

On an already running **isolated** PostgreSQL server, use its administrative
connection for setup (these example credentials are disposable):

```sql
CREATE ROLE sdat_benchmark_runner LOGIN PASSWORD 'sdat_benchmark_local';
CREATE DATABASE sdat_benchmark_example OWNER sdat_benchmark_runner;
```

Then set
`DATABASE_URL=postgres://sdat_benchmark_runner:sdat_benchmark_local@127.0.0.1:55439/sdat_benchmark_example`,
activate the backend venv and migrate. Use a direct connection; transaction
pooling cannot preserve this tool's session settings and backend identity.
Preparation refuses existing users or communities. Each trial uses a new
migrated database and a new output directory; the command never resets or drops
an existing database. Printed and recorded connection targets omit passwords.

## 3. CLI and workloads

`python manage.py benchmark_sdatch --confirm-disposable sdat_benchmark_example --output /tmp/sdat-example`

| Option | Default | Contract |
|---|---|---|
| `--meters` | 10 | 2–1000; final meter produces, others consume |
| `--days` | 30 | 1–30, starting June 1, 2025 Swiss civil time |
| `--memory-mib` | 1024 | Worker virtual-address-space guard, at least 256; not RSS |
| `--timeout` | 180 | Seconds for the entire worker, including startup, import, verification and diagnostic cleanup |
| `--diagnostic` | false | SQL accounting and coordinated PostgreSQL lock observation |
| `--output` | required | New directory containing manifests, checkpoints, logs and aggregate report |

Internal `--worker-state` and `--scenario` flags are hidden from help and must
be supplied together. Ordinary timing and diagnostic evidence are collected in
separate complete trials on fresh databases, not by replaying the same delivery.

Three ordered scenarios run against the state left by their predecessors:

- Monthly original: one block per meter plus an excluded reactive block;
  position 1 is held temporary data and position 2 is estimated.
- Sparse replacement: positions 2 and the final position per meter change by
  +1 kWh, clearing the estimated condition at position 2.
- Full replacement: every delivered value is original +2 kWh, promoting held
  position 1; position 2 remains estimated.

Each participant has a sent CHF 42 invoice. Fixtures are gzip-written one meter
block at a time (at most 2880 positions); no complete scenario XML is retained.
Manifests include compressed hash, compressed/XML sizes, UTC interval, civil
timezone, resolution, observation/block counts, preceding history, meter
directions and changed-value fraction. Allowed stress dimensions do not promise
successful import: larger XML can exceed the importer's decompression cap.

## 4. Measurement and reporting

The parent writes `report.json` before setup and checkpoints `phase` as `setup`,
`prepare`, each scenario name, then `complete`. Failures preserve the current
phase and `error`. It records versions, optional Git identity, hashes of command,
fixture/verifier and importer code, target, mode, workload and worker budgets.
Git metadata runs in the checkout with a five-second timeout; unavailable Git
is recorded rather than failing the trial.

Workers atomically checkpoint `<scenario>.json` with `worker_pid`, `scenario`,
`trial` and `phase` (`setup`, `import`, `post_import`, `verify`, `complete`). `import_completed`
means the importer returned, not that verification succeeded. It is saved before
diagnostic thread cleanup, so post-commit cleanup timeouts remain distinguishable. Exceptions preserve
phase and error; setup failures do not invent an import duration. Rejected
imports fail verification and retain their result status/counts.

| Evidence | Scope |
|---|---|
| `import_seconds` | Ordinary importer call, no SQL wrapper or contender |
| `instrumented_import_seconds` | Diagnostic importer call, including lock coordination, polling and SQL accounting; never ordinary timing |
| `peak_rss_kib` | Worker VmHWM immediately after importer return, before verification; includes process startup |
| `process_peak_rss_kib` | Whole worker high-water mark including verification and cleanup |
| `sampled_peak_rss_kib` | Parent's sampled high-water mark; a lower-bound fallback when the worker dies |
| `cgroup_memory_before/after` | Shared parent/worker group, cumulative peak/events, memory/swap/CPU limits when available |
| `writes` | Diagnostic successful SQL execution counts, rows/time and maximum rows/parameters/SQL characters, grouped by operation/table; writes may subsequently roll back |

Diagnostic trials identify importer and contender sessions with unique run tags.
After the importer's first successful billing advisory-lock call, the wrapper
waits for PostgreSQL to confirm the contender is blocked by that importer PID.
It uses `pg_stat_activity`, `pg_blocking_pids()` and snapshot clearing. SQL
matching is specific to the current billing-lock implementation and fails closed
if no lock is observed. Each coordination wait and control SQL call has a five-second bound; the
contender waits for the importer to reach its lock under the whole-worker
watchdog. A confirmed contender wait may expire after five seconds on long
imports (`bounded_wait_expired`); that is valid proof, not a full-duration lock
latency measurement. Ordinary trials do none of this coordination.

## 5. Bounds, recovery and correctness

Parent and worker connections have a five-second connection timeout and
five-second control statement/lock timeouts. During the importer call its
statement timeout is the worker budget; control statements and verification
return to five seconds. History scans stream 256 rows at a time and check a
30-second client-side deadline; a pending database operation is additionally
bounded by the SQL timeout. The scans warm caches before imports, so trials
must not be described as cold-cache measurements.

The parent kills and waits for a worker exceeding its wall budget. Afterwards,
it terminates/waits for only that run/scenario's tagged sessions, in the current
database and role, with a 15-second recovery deadline and bounded termination
calls. No administrative role grant is required to terminate its own sessions.
`database_cleanup.sessions_gone` confirms settlement; a cleanup failure records
`cleanup_error` and leaves the database outcome unknown.

After a failed/malformed worker result, the surviving parent reconnects and
compares full streamed reading, quarantine, invoice, invoice-item and impact
history digests. `history_unchanged=false` may mean a committed import followed
by failed verification; it does not imply partial writes. Import logs are
excluded because failed-attempt logs are expected. Do not inspect history as
final state when cleanup was not confirmed.

Before import, the worker snapshots invoice IDs and every invoice/item field.
Verification checks that snapshot, reading counts/energy, scenario counters,
retained/truncated audit counts, every reading's slot/value/condition/provenance,
and the exact expected invoice-impact IDs and complete change totals. Expected
values are calculated independently from fixture generation; mismatches name
the meter, timestamp and field.

The address-space guard applies only to workers. Enforce whole-group memory,
swap and wall-time bounds externally for stress trials, with PostgreSQL limited
separately. Parent/group OOM or host loss can prevent the last checkpoint, so
retain supervisor status/logs and independently inspect the disposable database.
Capacity comparisons require identical seed state, stated cache conditions and
repetitions; do not infer a production limit from one diagnostic trial.

## 6. Validation

`backend/metering/test_benchmark_sdatch.py` collects 37 cases:

| Test | Cases | Checks |
|---|---:|---|
| `test_database_guard` | 9 | Target, confirmation and role restrictions |
| `test_atomic_result_preserves_previous_json` | 1 | Interrupted write preserves the prior checkpoint |
| `test_capacity_trial_has_no_probe_or_sql_wrapper` | 1 | All ordinary scenarios avoid diagnostic instrumentation |
| `test_verification_detects_corruption` | 4 | Invoice deletion, subtotal/item changes and provenance corruption |
| `test_worker_failure_keeps_phase_and_error` | 3 | Address-limit, fixture and importer failures |
| `test_post_commit_checkpoint_precedes_diagnostic_cleanup` | 1 | Returned importer outcomes survive diagnostic cleanup failure |
| `test_rss_failure_does_not_mask_import_error` | 1 | Both errors remain visible |
| `test_malformed_result_keeps_exit_and_database_outcome` | 3 | Invalid worker results retain exit, cleanup and history evidence |
| `test_watchdog_retains_partial_verification_checkpoint` | 1 | Timeout after commit preserves completion and changed history |
| `test_failed_cleanup_does_not_claim_history_equality` | 1 | Unsettled sessions leave the outcome unknown |
| `test_spawn_failure_is_structured` | 1 | Process creation failure is recorded |
| `test_stale_output_is_not_reused` | 1 | Existing worker output is refused |
| `test_preparation_failure_leaves_initial_report` | 1 | Preparation error keeps its report; parent has no address-space cap |
| `test_invalid_bounds_are_rejected` | 2 | Memory floor and positive worker watchdog |
| `test_git_metadata_failure_is_optional` | 1 | Missing Git does not invalidate measurements |
| `test_largest_fixture_generation_fits_512_mib` | 1 | Fresh process writes 1000-meter/30-day fixtures within 512 MiB address space |
| `test_real_postgres_diagnostic_confirms_blocker` | 1 | Real importer lock/blocker, SQL summaries and timeout restoration |
| `test_cleanup_stops_owned_stalled_backend_only` | 1 | Bounded recovery preserves an unrelated session |
| `test_real_command_smoke` | 2 | Actual capacity/diagnostic commands, workers, guards and limits |
| `test_fixture_hashes_sizes_and_observation_counts_are_reproducible` | 1 | Stable gzip bytes and correct manifests |

PostgreSQL tests confirm the real importer blocker and terminate a stalled owned
backend while preserving an unrelated connection. Opt-in command tests run the
real parent, workers, guards, address-space limits, migrations and reports with
two meters/one day. Set `SDAT_BENCHMARK_DATABASE_URL` and/or
`SDAT_BENCHMARK_DIAGNOSTIC_DATABASE_URL` to separate fresh isolated databases,
then run `pytest metering/test_benchmark_sdatch.py -k real_command_smoke -n 0`
from `backend/`. Those tests explicitly use production settings; the rest of the
suite can use SQLite. Do not run other PostgreSQL tests on that isolated server
simultaneously, since their PUBLIC-connectable test databases violate its guard.
