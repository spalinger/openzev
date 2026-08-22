# OpenZEV general improvement roadmap

Reviewed against the current branch and repository on 2026-08-22.

## Executive priority

OpenZEV already has a strong functional core: server-side invoice calculation, a substantial backend test suite, explicit invoice workflow actions, role-aware queryset scoping, audit events, typed frontend builds, container/Helm packaging, and detailed feature specs.

The next work should **not** be another broad cosmetic refactor. The highest-value order is:

1. **Close tenant-isolation and authentication holes.**
2. **Make production data recoverable and failures visible.**
3. **Constrain API contracts and writes so future fields/endpoints fail safely.**
4. **Harden deployment, uploads, secrets, and privacy.**
5. **Then reduce frontend/backend complexity and improve UX quality.**

Do not add major billing features until the P0/P1 work below is complete.

---

# Current strengths worth preserving

- Invoice totals are computed server-side from persisted tariffs/readings; clients do not set authoritative invoice totals.
- Generic invoice create/update is intentionally not exposed.
- Invoice state transitions are centralized in workflow functions.
- ZEV-scoped querysets protect many list/detail reads.
- Many sensitive/admin endpoints have declarative DRF permissions.
- API keys are generated with high entropy, stored hashed, compared in constant time, shown once, revocable, expiring, and throttled.
- JWTs use `httpOnly` cookies rather than local storage.
- Audit events have role/ZEV scoping, snapshots, redaction, request IDs, and useful indexes.
- Whole-ZEV transfer archives have meaningful malformed/corrupt-input tests.
- Backend suite: ~1000 tests and ~86% coverage.
- Frontend uses strict TypeScript and has a working unit-test/build pipeline.
- Specs/ADRs document billing and security decisions unusually well for a project of this size.

The plan below should strengthen these patterns rather than replace them with a new framework or microservices.

---

# P0 — fix before public production exposure

## P0.2 Restrict the global user list

> Status: ✅ shipped in #430 (2026-08) — `UserListCreateView` is now `IsAdmin`-only.

`UserListCreateView` formerly returned every active participant user to every ZEV owner; since #430 the endpoint is admin-only (`backend/accounts/views.py:96`). Frontend consumers are admin pages and account linking is admin-only.

Applied fix:

```python
class UserListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAdmin]
```

If an owner-specific list is genuinely needed, expose a separate minimal serializer/queryset scoped through `participations__zev__owner=request.user`.

### Acceptance criteria

- Owner A cannot enumerate Owner B's user account, name, or email. — ✅ met via `IsAdmin` gate.
- Admin account management remains functional. — ✅ met.
- Audit filter options continue using their dedicated visibility-scoped endpoint (`backend/audit/views.py:94` `AuditFilterOptionsView`). — ✅ met.

## P0.3 Add CSRF enforcement for cookie JWTs

> Status: ✅ shipped in #446 (2026-08) — `CookieJWTAuthentication` now enforces CSRF via `SessionAuthentication.enforce_csrf` on cookie-authenticated unsafe requests; `CsrfViewMiddleware` kept for admin/Django views, `set_auth_cookies(request,response)` issues `csrftoken` via `get_token`, `CSRF_TRUSTED_ORIGINS` defaults to `CORS_ALLOWED_ORIGINS`, frontend `api` axios instance scopes `xsrfCookieName`/`xsrfHeaderName` (no `axios.defaults`), case-insensitive `Api-Key` and unified `_make_jwt_for_user` claims (`backend/accounts/jwt_utils.py`).

`CookieJWTAuthentication` accepts JWTs from cookies but does not run a CSRF check. `SameSite=Lax` is defense-in-depth, not the primary check.

- Enforce CSRF only for cookie-authenticated unsafe requests.
- Issue the CSRF cookie during login/refresh (and verify-email/initial-password/OAuth/impersonation).
- Configure Axios `xsrfCookieName`/`xsrfHeaderName` scoped to `api` instance.
- Add tests for missing, invalid, and valid tokens.
- Retain bearer/API-key support without CSRF (case-insensitive `Api-Key`).

### Acceptance criteria

- Cookie-authenticated POST/PATCH/DELETE without CSRF fails. — ✅ met via `accounts/test_csrf.py` (9 tests).
- Same requests with valid CSRF pass. — ✅ met.
- Bearer and API-key clients continue to work. — ✅ met (`Api-Key` case-insensitive at `backend/accounts/authentication.py:26`, `ApiKeyAuthentication` lower).
- Login/refresh/logout behavior is tested. — ✅ met (`test_csrf.py` + `tests/api-client-refresh.test.ts` 21 files/124 tests); `CSRF_TRUSTED_ORIGINS` defaults to `CORS_ALLOWED_ORIGINS` (`backend/config/settings.py:197`), frontend `frontend/.env.example:1` → `/api/v1` same-origin note in `README.md:260`.

## P0.5 Add secret and dependency scanning

- Add Gitleaks with an `ozv_...` rule and full-history checkout.
- Add `pip-audit`/OSV scanning.
- The `brace-expansion` transitive advisory is mitigated in the lockfile at `5.0.9`; retain scanning to prevent regression.
- Add Trivy vulnerability scanning, not only SBOM generation.
- Keep Renovate, but set a security-update SLA.

### Acceptance criteria

- PRs fail on a verified secret or high/critical exploitable dependency unless explicitly waived with an issue/owner/expiry.
- CI output is redacted.
- Security exception process is documented.

## P0.6 Harden file parsing and upload limits

Current CSV/XLSX/XML import paths have no explicit application upload limit. SDAT XML uses a default `lxml` parser.

- Set request/file size limits.
- Reject oversized CSV/XLSX/XML/ZIP before parsing.
- Use a hardened XML parser:

```python
parser = etree.XMLParser(
    resolve_entities=False,
    load_dtd=False,
    no_network=True,
    huge_tree=False,
)
tree = etree.parse(file, parser)
```

- Add XML entity/DTD/zip-bomb/oversized-file tests.
- Bound rows, cells, error collection, archive members, and decompressed bytes.
- Keep parsing streaming where possible.

### Acceptance criteria

- XXE and DTD payloads are rejected.
- Oversized uploads return 413/400 without high memory use.
- Error arrays are capped.
- Import behavior for legitimate files is unchanged.

---

# P1 — production readiness and operational safety

## P1.1 Add error tracking and structured observability

Current audit events and ordinary logs are useful but do not replace error tracking.

Implement Sentry or self-hosted GlitchTip/OpenTelemetry-compatible tooling:

- backend Django + Celery exceptions;
- frontend error boundary and unhandled rejection capture;
- release/version/environment tags;
- source maps uploaded from CI;
- request ID/correlation ID on logs and responses;
- alerting for 5xx rate, Celery failures, stuck jobs, email failures, and backup failure.

Strictly redact:

- credentials, cookies, authorization headers;
- JWT/API/OAuth tokens and OAuth secrets;
- participant identity/address/email;
- IBANs;
- import file data and invoice PDFs.

Return request IDs:

```python
response["X-Request-ID"] = request.audit_request_id
```

Do not unconditionally trust client-supplied `X-Forwarded-For`; only trust a configured ingress/proxy chain.

### Acceptance criteria

- A synthetic backend exception and frontend error appear in the selected tracker with release and request ID.
- No credential/PII appears in the event.
- Celery failures alert.
- On-call/owner and severity routing are documented.

## P1.2 Automate backups and perform a restore drill

Current manual `pg_dump` instructions are not a recovery system.

- Managed PostgreSQL backup + PITR/WAL retention.
- Back up `/app/media` invoice PDFs separately with object versioning.
- Off-site/separate-account storage and encryption.
- Define RPO/RTO and ownership.
- Alert on backup failures and stale last-success timestamp.
- Restore into a disposable environment at least quarterly.
- Validate migrations, row counts, relationships, and sample PDFs.

### Acceptance criteria

- A real backup has been restored successfully.
- Drill duration and result are recorded.
- One sample invoice PDF and representative ZEV can be read after restore.
- RPO/RTO are documented and met.

## P1.3 Add login/auth/email throttling

> Status: ⚠️ partially shipped in #433 — auth login/refresh/register/verify-email and OAuth initiate/exchange are now throttled per-IP (`backend/accounts/throttling.py`, `backend/config/settings.py:153`); remaining items below still open.

API-key and the above auth endpoints are now throttled. Add scoped throttles for the remaining:

- password changes and invitation resets;
- invoice email/retry endpoints;
- expensive report/PDF endpoints;
- import preview/upload.

Use per-IP plus per-account/email controls where appropriate, with proxy-aware client IP handling.

### Acceptance criteria

- Brute-force tests hit 429.
- Normal frontend flows stay below limits.
- Limits are configurable and observable.
- Reverse-proxy IP handling cannot be spoofed trivially.

## P1.4 Harden production containers and Helm defaults

### Current issues

- Backend/fullstack containers run as root.
- Build tools and test/dev packages ship in runtime images.
- Backend container runs migrations at every replica startup.
- Helm security contexts/resources default to empty.
- Backend health probes are TCP-only.
- Worker has no health probes.
- Shared `ReadWriteOnce` media storage limits scaling/placement.

### Work

- Multi-stage Python build; split prod/dev dependencies.
- Add non-root user.
- Default Kubernetes security context:
  - `runAsNonRoot: true`
  - `allowPrivilegeEscalation: false`
  - drop all capabilities
  - `seccompProfile: RuntimeDefault`
  - read-only root filesystem where practical
- Move migrations to a release Job/init step with locking, not every web replica.
- Add `/health/live` and `/health/ready` endpoints; readiness checks DB/required services, liveness checks process only.
- Add worker health checks.
- Set resource requests/limits and disruption budgets.
- Plan object storage for media if scaling beyond one node/replica.

### Acceptance criteria

- Containers run non-root.
- Kubernetes restricted-pod policy passes.
- Two backend replicas can start without migration races.
- Readiness fails when DB is unavailable; liveness does not create restart loops for transient dependencies.
- Runtime image excludes compilers, pytest, Ruff, Faker, and build headers.

## P1.5 Add PostgreSQL CI

Most tests run against SQLite while production uses PostgreSQL.

Add a CI lane with a PostgreSQL service for:

- migrations;
- constraints and transaction behavior;
- concurrent assignment/tariff/invoice numbering tests;
- query plans/indexes;
- backup/restore smoke test.

Keep fast SQLite tests if useful, but do not treat them as the only database gate.

### Acceptance criteria

- Full or critical integration suite passes on PostgreSQL.
- `makemigrations --check` and `migrate --check` run in CI.
- Race-sensitive tests run using real transactions.

---

# P2 — API/data correctness and architecture

## P2.1 Replace `fields = "__all__"` and broad ModelViewSets

`fields="__all__"` makes future model fields writable/public by default. Broad `ModelViewSet` exposes methods unless somebody remembers to remove them.

- Use explicit serializer field lists.
- Mark ownership, status, totals, hashes, audit metadata, and system fields read-only.
- Use only required mixins (`List`, `Retrieve`, `Create`, etc.).
- Separate command serializers from response serializers.
- Use dedicated workflow endpoints for financial/destructive changes.

### Acceptance criteria

- Adding a model field cannot expose it through the API without an explicit serializer edit.
- OpenAPI shows correct read/write semantics.
- Unused methods return 405.

## P2.2 Make OpenAPI authoritative and generate frontend contracts

Schema generation currently reports many unique errors/warnings, and at least one recently added endpoint was documented with the wrong response shape.

- Resolve every schema-generation error.
- Add serializers/`extend_schema` for APIViews and custom actions.
- Type all path parameters and serializer method fields.
- Check generated schema into CI artifacts or diff it in PRs.
- Generate TypeScript API types/client from OpenAPI.
- Keep UI view models separate from transport types.

### Acceptance criteria

- Schema generation has zero errors and a small documented warning budget (ideally zero).
- Frontend CI regenerates types and fails on drift.
- Contract tests cover representative endpoints and error responses.

## P2.3 Centralize tenant policies, not just queryset scoping

Create a small policy layer that answers:

- can view/manage this ZEV?
- can select this related object?
- can perform this workflow transition?
- can use this endpoint via API key?

Use it in queryset scoping, serializer relation validation, custom actions, and tests. Avoid duplicating manual `if not admin and zev.owner != user` checks across large view modules.

### Acceptance criteria

- One policy implementation per permission rule.
- Every custom action uses a scoped resolver rather than global `.objects.get()` followed by ad hoc checks.
- Security matrix tests map directly to documented policies.

## P2.4 Strengthen database invariants and concurrency

Application `full_clean()` checks are not enough for concurrent writes or alternate write paths.

Prioritize database enforcement for:

- non-overlapping metering assignments;
- tariff-version overlap/invariant rules where PostgreSQL permits exclusion constraints;
- participant/metering-point same-ZEV relationships where practical;
- invoice numbering/creation concurrency;
- idempotent async jobs and event processing.

Use `transaction.atomic`, `select_for_update`, exclusion/unique/check constraints, and concurrency tests.

### Acceptance criteria

- Concurrent conflicting writes cannot both commit.
- Constraint violations return controlled API errors.
- SQLite limitations are documented; PostgreSQL integration tests prove production behavior.

## P2.5 Define audit consistency semantics

Several write paths save business data and then write audit events under autocommit. If audit insertion fails, the business change may persist while the client sees 500 and no audit event exists.

Choose per operation:

- **atomic audit:** business write and audit event in one transaction;
- **durable async/outbox:** business write and outbox record commit together, worker emits external event;
- **best effort:** explicitly justified (e.g. transfer audit after an already completed artifact).

### Acceptance criteria

- Every audited mutation documents one of the three semantics.
- Critical governance/billing changes cannot silently commit without their required audit record.
- Retry behavior does not duplicate business operations.

## P2.6 Harden async jobs

- Make all Celery jobs idempotent.
- Queue with transaction `on_commit` after DB writes.
- Add stable idempotency keys for invoice/PDF/email batches.
- Configure retry/backoff/jitter/time limits/late acknowledgement deliberately.
- Persist job status for user-visible long jobs.
- Add dead-letter/failed-job operational guidance.

### Acceptance criteria

- Re-running a task cannot duplicate invoice/email/payment-like effects.
- Broker outage and worker crash tests are present.
- Operators can identify and retry failed work safely.

---

# P3 — frontend and backend maintainability

## P3.1 Break up monolithic pages and views by workflow

Largest frontend pages are roughly 500–860 lines; largest backend view modules are roughly 500–780 lines.

Prioritized frontend candidates:

1. `ZevListPage.tsx`
2. `ImportsPage.tsx`
3. `AdminPdfTemplatesPage.tsx`
4. `DashboardPage.tsx`
5. `AdminAccountsPage.tsx`
6. `AdminSystemSettingsPage.tsx`

Split into:

- page orchestration;
- domain hooks/mutations;
- form schemas/mappers;
- table/card sections;
- modal state reducers;
- pure utility functions with unit tests.

Prioritized backend candidates:

- `accounts/views.py`
- `zev/views.py`
- `invoices/views.py`
- `metering/views.py`
- `accounts/views_oauth.py`

Split by resource/workflow into modules, but keep service boundaries inside the monolith. Do **not** create microservices.

### Acceptance criteria

- Pages mostly orchestrate rather than contain full workflows.
- Complex state transitions are reducer/hook-tested.
- View modules are organized by endpoint/resource with shared policy/service helpers.
- No behavior-only refactor is merged without regression tests.

## P3.2 Finish i18n migration

There are many hard-coded user-facing English strings despite the repository rule requiring i18n. `Layout.tsx` is now fully translated; remaining hotspots notably include:

- `ImportsPage.tsx`
- `EmailLogsModal.tsx`
- loading/error/not-found pages
- credentials/copy feedback

Move all user-facing strings to locale files. Add an ESLint rule or AST check for obvious JSX text/attributes outside approved technical labels.

Use official Swiss terminology (`RCP`/`RCPv` in French/Italian) and native-language review for legal/billing copy.

### Acceptance criteria

- No untranslated user-facing text in normal flows.
- Locale key parity test passes.
- Critical pages are manually checked in DE/FR/IT/EN.

## P3.3 Standardize the UI system

The frontend mixes Mantine, MUI, Font Awesome, native controls, inline styles, and custom CSS. This increases bundle size and inconsistent behavior/accessibility.

- Choose one primary component system for forms/modals/tabs/tables where feasible.
- Keep MUI DataGrid/date pickers only if they provide needed functionality.
- Define shared design tokens and accessible components.
- Reduce inline styles in large pages.
- Do not attempt a single all-at-once rewrite; migrate page by page.

### Acceptance criteria

- New pages use one documented component pattern.
- Bundle budget is tracked.
- Forms/modals/tables have consistent keyboard/focus/error behavior.

## P3.4 Standardize frontend error and loading handling

- Add a top-level error boundary.
- Create typed API error utilities; reduce `any` and ad hoc catches.
- Define query error/retry/toast behavior.
- Never silently swallow errors without user feedback or telemetry.
- Add skeleton/empty/error components.

### Acceptance criteria

- Unhandled rendering errors show a recoverable translated fallback and are reported.
- API errors have consistent user-safe messages and request IDs.
- No critical mutation failure is represented only by `console.error`.

## P3.5 Improve backend static analysis incrementally

Ruff currently checks mostly syntax/Pyflakes. Expand in staged, autofixable PRs:

- bugbear (`B`)
- security-relevant subset (`S`) with reviewed exceptions
- Django rules (`DJ`)
- upgrade rules (`UP`)
- simplify/performance rules where low noise
- typing with mypy or pyright for services/calculators first

Do not enable hundreds of findings in one PR. Establish per-directory ratchets/no-new-debt.

---

# P4 — testing, performance, privacy, and product quality

## P4.1 Add browser E2E and visual regression gates

Current Playwright scripts generate documentation screenshots but do not assert snapshots or run in PR CI.

Add:

- functional E2E for login, owner scope, participant scope, import, tariff creation, invoice generation/workflow;
- five deterministic visual snapshots: login, owner dashboard, participants, tariffs, invoices;
- accessibility checks with axe;
- failure artifacts/video/trace.

Keep documentation capture separate from visual regression baselines.

## P4.2 Add frontend component/integration coverage

Backend coverage is strong; frontend coverage is mostly utilities/hooks.

Prioritize tests for:

- System Settings OAuth secret behavior;
- audit filters and owner scoping;
- participant/metering-point forms;
- import wizard transitions/errors;
- invoice workflow action visibility;
- auth refresh/CSRF/error boundary;
- locale key parity.

Avoid chasing a percentage first; cover expensive regressions and permission-dependent behavior.

## P4.3 Add performance budgets and query-count tests

Potential hotspots include participant serialization, cached building-footprint lookup, nested metering-point serialization, analytics over large reading ranges, audit filtering, and PDF/report generation.

- Add query-count budgets for list endpoints.
- Add realistic volume fixtures and benchmark tests.
- Use `EXPLAIN ANALYZE` on PostgreSQL.
- Add pagination or async export where responses can grow unbounded.
- Add database indexes based on measured plans.
- Load-test imports, chart queries, annual reports, and invoice batches.

## P4.4 Address geocoding/privacy explicitly

Participant street address/postal code/city is sent to the public Nominatim service, and failures log the address. Browser map tiles also contact external infrastructure.

- Document this data flow and legal basis.
- Prefer self-hosted/contracted geocoding or make it opt-in/configurable.
- Stop logging full addresses; log participant/request IDs or a hash.
- Review map-tile privacy and CSP.
- Define retention/deletion rules for participant, audit, import, and email-log data.

## P4.5 Add CSP and security headers

After removing/controlling inline styles/scripts as needed:

- Content-Security-Policy
- Referrer-Policy
- Permissions-Policy
- HSTS
- `X-Content-Type-Options: nosniff`
- frame restrictions (`frame-ancestors`)

Test OAuth callbacks, PDF previews, maps, and fonts before enforcing CSP.

---

# Suggested implementation sequence and PR roadmap

## Milestone 0 — emergency security (week 1)

1. `fix/security-user-list-scope` — ✅ shipped in #430
2. `fix/security-cookie-csrf` — ✅ shipped in #446
3. `ci/secret-and-dependency-scanning`
4. `fix/security-upload-parsing-limits`

**Exit gate:** `P0.2` user-list leak closed in #430; `P0.3` CSRF closed in #446; remaining gate is upload limits and scanners green.

## Milestone 1 — production operations (weeks 2–4)

7. `feat/observability-error-tracking`
8. `ops/database-media-backups`
9. `build/harden-runtime-containers`
10. `ops/health-readiness-and-migrations`
11. `ci/postgres-integration-tests`
12. `fix/security-auth-throttling` — ⚠️ partially shipped in #433 (remaining: password-change, email/report, import throttles)

**Exit gate:** monitored deployment, tested restore, non-root containers, safe migrations, production DB lane; auth throttling partially done in #433.

## Milestone 2 — contract/data safety (weeks 5–8)

13. `refactor/api-explicit-serializers`
14. `fix/openapi-contracts`
15. `build/generated-frontend-api-types`
16. `refactor/tenant-policy-layer`
17. `fix/database-concurrency-invariants`
18. `refactor/audit-transaction-semantics`
19. `refactor/celery-idempotency`

**Exit gate:** zero schema errors, explicit API surface, generated contract types, tested concurrency/idempotency.

## Milestone 3 — maintainability and UI quality (weeks 9–14)

20. Split `ZevListPage` and `ImportsPage` first.
21. Split account/ZEV/invoice/metering backend view modules.
22. Finish i18n migration.
23. Standardize shared form/modal/table patterns.
24. Add typed global frontend error handling.
25. Expand lint/type-check ratchets.

**Exit gate:** critical workflows are modular, translated, typed, and independently testable.

## Milestone 4 — regression/performance/privacy (ongoing)

26. Playwright functional + visual + axe CI.
27. Query-count and PostgreSQL performance budgets.
28. Large-import/report load tests.
29. Geocoding/map privacy remediation.
30. Retention/deletion runbooks and recurring recovery/security drills.

---

# What not to prioritize yet

- Do not split into microservices.
- Do not rewrite Django/React or replace the billing engine.
- Do not chase 100% coverage before fixing missing security/E2E scenarios.
- Do not perform a one-shot UI-library migration.
- Do not add online payments before webhook/idempotency/security design exists.
- Do not add more broad cleanup PRs until P0 isolation issues are closed.
- Do not treat audit events as error tracking or ZEV export as backup.

---

# Top ten actionable backlog items

1. Make `/auth/users/` admin-only/scoped. — ✅ shipped in #430
2. Enforce CSRF for cookie JWT requests. — ✅ shipped in #446 (`CookieJWTAuthentication` + `SessionAuthentication.enforce_csrf`, `CsrfViewMiddleware` kept, `jwt_utils._make_jwt_for_user`, `api` xsrf scoped, 9 backend + 124 frontend tests)
3. Add upload limits and hardened XML parsing.
4. Add Gitleaks, dependency scanning, and Trivy vuln scanning (npm advisory already mitigated at `5.0.9`).
5. Add Sentry/GlitchTip with PII scrubbing and request IDs.
6. Automate DB/media backups and complete a restore drill.
7. Run non-root hardened containers with safe migration/health patterns.
8. Fix OpenAPI completely and generate frontend API types.

Only after those: monolith/page decomposition, UI standardization, visual E2E, and performance/privacy improvements.
