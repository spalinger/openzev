# ADR 0010: Centralized audit event stream for high-risk operational workflows

- Status: Accepted
- Date: 2026-05-08
- Supersedes: n/a
- Superseded by: n/a

## Context

OpenZEV currently has domain-specific operational traceability in a few places,
most notably invoice email attempts via `EmailLog` and metering import runs via
`ImportLog`. ADR 0008 intentionally limited the initial scope of audit logging
to those workflows and deferred a fully centralized audit ledger because it was
more complexity than the project needed at the time.

The product now contains enough privileged and billing-relevant write workflows
that the domain-specific approach is no longer sufficient. Operators need a
single place to investigate who changed invoice-relevant settings, who mutated
tenant data, which destructive actions were attempted, and how asynchronous
operations completed.

The missing capability is not generic runtime logging. It is a business-level
audit stream that captures actor, tenant scope, target object, result, and a
small structured diff for high-risk write actions.

This decision addresses the architectural shape of that centralized audit
system, including where audit events are recorded, how they are scoped, and how
to avoid both noisy low-value logging and accidental persistence of secrets.

## Decision

Adopt a centralized append-only audit event stream for high-risk operational
workflows.

- Introduce a dedicated `AuditEvent` model in a new `audit` app as the single
  cross-domain store for business audit events.
- Record audit events through an explicit audit service layer, not primarily
  through generic Django model signals.
- Scope audit events to a ZEV whenever the affected object is tenant-bound, and
  keep global/system/auth events unscoped (`zev = null`).
- Store structured event metadata with actor snapshot, target snapshot, action
  category, action type, status, request correlation data, and a whitelisted
  field diff.
- Keep the audit stream append-only from application code. Normal runtime code
  does not update or delete audit records.
- Audit only high-risk write workflows and async outcomes in v1; exclude normal
  read access logging.
- Enforce a central redaction policy so secrets, credentials, template bodies,
  raw uploads, and other sensitive payloads are omitted or masked before
  persistence.
- Expose audit events through read-only API endpoints with admin-global access
  and ZEV-owner-scoped access.
- Implement the first coverage slices in explicit business workflows: invoice
  lifecycle, async email/import outcomes, governance settings, impersonation,
  and privileged account/tenant mutations.

### Why explicit service calls instead of generic signals

The primary architecture uses explicit service calls at the business workflow
boundary because audit events need context that model signals do not reliably
provide:

- acting user,
- request ID / IP / user agent,
- whether the action was denied, queued, or failed,
- the business meaning of the action,
- tenant scope inferred from surrounding workflow state,
- redacted field-diff allowlists per action.

Signals may still be used as narrow supporting mechanisms where they are safe
and context is complete, but they are not the main audit architecture.

### Event design constraints

The centralized audit stream is not a full immutable compliance ledger for every
database mutation. It is a focused operational audit system with these
constraints:

- one event row per business action or async outcome,
- small structured payloads,
- whitelisted diffs only,
- indexed for admin and tenant investigations,
- no raw secret or document content,
- no audit of standard reads in v1.

## Consequences

Positive:

- Gives OpenZEV one consistent audit surface across accounts, governance,
  tenant management, tariffs, metering, and invoices.
- Preserves actor, tenant, and target context that is hard to recover from raw
  runtime logs after the fact.
- Enables a simple admin audit-log UI and scoped owner visibility without
  inventing domain-specific audit pages for each feature.
- Reduces ambiguity around how future privileged workflows should record
  traceability.

Trade-offs:

- Requires explicit instrumentation in multiple business workflows rather than a
  single generic hook.
- Introduces a new cross-cutting data model, middleware, service layer, API,
  and tests.
- Some write paths will remain unaudited until their integration slice is
  implemented.
- Careless instrumentation could still create noisy or overly large payloads if
  the redaction and allowlist rules are not followed consistently.

## Alternatives considered

1. Keep only domain-specific audit models such as `EmailLog` and `ImportLog`.
   - Rejected because cross-domain investigations would still require operators
     to manually correlate multiple models and would not cover privileged
     settings, account, tariff, or tenant mutations.
2. Use Django model signals as the primary audit mechanism.
   - Rejected because signals do not reliably carry actor, request, denial,
     async, or business-intent context, and would produce lower-quality audit
     events.
3. Audit every read and write request.
   - Rejected because the noise, storage, privacy impact, and review burden are
     too high for the product’s current scope.
4. Build a full immutable compliance ledger for all model changes.
   - Rejected for now because it adds substantial complexity beyond the project’s
     immediate operational needs.

## Notes

- This ADR extends ADR 0008 rather than replacing it. ADR 0008 documented the
  initial audit logging scope and explicitly deferred a centralized ledger; ADR
  0010 records the decision to implement the centralized audit stream now.
- Implementation details and rollout phases are specified in
  `docs/specs/2026-05-audit-log-and-operational-traceability.md`.
- The first implementation slice should prioritize invoice lifecycle,
  governance-setting mutations, impersonation/account changes, and async email
  or import outcomes.
