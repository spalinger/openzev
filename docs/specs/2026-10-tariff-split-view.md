# Feature Spec: Expandable tariff rows and secondary task pane

- Spec ID: SPEC-2026-10-tariff-split-view
- Status: Implemented, pending review (pilot acceptance and ADR 0040 are not yet signed off)
- Scope: Major
- Type: Change
- Owners: Core maintainers
- Created: 2026-10-17
- Target Release: Phase 1 of the UI patterns rollout
- Related Issues: n/a
- Related ADRs: [0040](../adr/0040-overlay-and-disclosure-pattern-rules.md)
- Related specs: [UI patterns and component catalog](2026-10-ui-patterns-and-component-catalog.md) (§6.2 pane contract, §11 rollout), `2026-03-tariffs-and-billing-engine`, `2026-08-ui-redesign-pdf-style` §15.3, `2026-09-dynamic-tariffs`, `2026-09-percentage-tariff-bands`
- Impacted Areas: backend, frontend, docs

---

Tariff details expand inside their category table, within the existing tariff
row, on desktop and narrow screens. The former viewing sidebar has been removed;
only focused creation/editing tasks use the in-flow side pane. This supersedes
the tariff pilot's original list-and-detail layout and is an explicit exception
to the proposed reference-spec §5/§6.2 viewing-pane rule. Billing calculations
and permissions are unchanged. Static-energy creation accepts atomic initial
bands through `initial_periods`; timed bands require both time endpoints.

## 1. Problem and outcome

| Observation (commit `ecb0c962`) | Implication |
|---|---|
| `TariffDetailDrawer.tsx` is an overlay sized `clamp(720px, 60vw, 1080px)` | The list stays clickable but space is not reserved, so part of it is covered. |
| `TariffCategorySections.tsx` already shows prices, schedules, validity, notes and warnings per row | The pane adds version history, actions and, for dynamic tariffs, charts and price records; it does not repeat the row. |
| Editing varies in size: `TariffFormModal.tsx` branches during creation, an existing static-energy version can expose mainly dates and notes, rename is one field, new-version and period tasks have their own dialogs | One editing surface has to cover a one-field rename and a many-band creation. |
| `TariffsPage.tsx` stores `tariff` / `version` in the URL but uses `replace: true` on open and close; the validity filter is local state | Back does not return to the list; deep links already exist and are kept. |
| Tariff forms have no dirty-close guard; save errors are toasts or a shared banner; submit disables but fields stay editable | The reference spec §6.1 and §8.2 apply. |
| Participants and invoices share `.table-card.invoice-rows` and container-query reflow | The narrowed tariff list can reuse them. |

Outcome: tariffs are inspected in expandable table rows; a secondary task pane
opens only for an explicit create/edit action. Only one tariff can be expanded at a time.

## 2. Scope

### In scope

| Area | Details |
|---|---|
| Overview | Current and upcoming prices together, Ended tariffs; plain validity dates; table treatment (§4) |
| Containers | Inline tariff details; secondary task pane; narrow behaviour and navigation (§5) |
| Editing | Create, edit, rename, schedule a price change, periods (§6) |
| Labels | Counts and badges on the tariff screen (§4) |

### Out of scope

- Billing calculations, versioning semantics and permissions. The creation API
  extension and timed-band validation are described in §6.
- The tariff overview PDF and its scope choice at download (unchanged).
- Other drawers, wizards and dialogs (later phases of the rollout).
- Billing's layout. The tooltip rule in §4 should guide it when it is next revisited.

Terminology is defined in the [guide glossary](../user-guide/15-glossary.md).
Use “validity window” for a version's dates and “price band” for recurring
pricing; “period” alone is ambiguous between them.

## 3. Actors, permissions, and ZEV scope

Unchanged. A viewer reads only: no Edit, version, rename, duplicate, delete or
band controls (#761), but the same inline details and warnings. Scope and access
changes clear the selection, expanded rows, task pane and any draft immediately; an obsolete
completion must not select or reopen anything (`useWriteScope`, reference spec §3). Submissions
retain their originating task session, checked at submission and API dispatch.
A pending request locks only its own task; replacement tasks remain editable.

## 4. Overview

**Files to start from:** `TariffsPage.tsx`, `useTariffPaneNavigation.ts`,
`useTariffEditor.ts`, `TariffCategorySections.tsx`, `TariffPricesCell.tsx`,
`TariffDetailPane.tsx`, the tariff forms, `useTariffCrud.ts` and
`useTariffVersions.ts`. The route and scoped series endpoint are unchanged.

- Show one combined overview of current and upcoming tariffs, then **Ended tariffs**,
  keeping the energy / grid fees / levies / metering category order inside each.
  This replaces the `FilterTabs` Valid / Upcoming / All view (`TariffListView`).
- Each series appears once, using today's version or its nearest future version.
  On a wide list, planned prices appear under a clock/from-date heading beside
  current prices under Today. Matching bands align by structural schedule
  and unit; price, label and explanation changes do not change recurrence.
  Changed schedules appear beside the current bands in a dated comparison group,
  with amounts aligned by row. Comparisons share the right-hand unit when it
  matches a priced current band; otherwise the planned group includes its unit.
  The pricing area receives two thirds of the desktop row width. The group selects the future configuration.
  An unpriced current version retains its missing-price explanation alongside
  that self-contained planned group. Every displayed rate names its full unit
  (CHF/kWh, CHF/month or CHF/year, with translated month/year labels); currency
  does not depend on a visible table header.
- At list widths up to 56rem, replace the extra comparison column and notice
  with a small, unboxed green clock beside Today. Its tooltip gives the planned date, bands
  and prices on hover, keyboard focus or touch; it does not expand the row.
  The planned from-date heading connects directly to its prices in one pale green column, and
  the clock uses the same green. Scheduled versions remain in the expansion. Future-only tariffs
  retain their sole price. Narrow collapsed rows place validity below the price
  and warning block. Ended tariffs contains only series with no current
  or scheduled version; earlier versions of active tariffs remain in their detail.
- The name button, chevron and summary row toggle expansion regardless of the
  selected version. Other actions and selected text do not toggle it. Opening
  another tariff closes the previous expansion. Each summary `tr` owns an
  adjacent detail `tr` with `td colSpan={5}` and a stable `aria-controls` target.
  Expansion hides summary prices/validity so the detail presents them once.

- Opening a tariff selects the version valid today, without changing the
  version blocks’ newest-first chronological order. An explicitly selected past
  or future version stays selected and is clearly identified. The version blocks stay visible; price charts appear only with changing prices;
  source facts and fetched interval records are visible directly.
  Important warnings stay visible.
- Historical rows are grey but readable, with explicit historical context. They
  stay accessible and can expose permitted corrections: past does not mean
  disabled, and a genuinely disabled record or action says why.
- Plain validity dates, not rounded validity pills. No tariff, fee, band or
  version totals unless they help a concrete task (reference spec §10.1).
  Warnings beside the name stay: a gap, a failed price fetch.
- Tooltips explain ambiguous or truncated information but are supplementary:
  essential meaning is available on touch, and explanatory interactions also
  work with the keyboard.
- Rows have a named, keyboard-accessible control that expands the row (the name
  button, as today); chevron names identify the tariff, and per-band future-price
  controls name only that band, its price, effective date and action. Row click
  is an extra. The tariff overview PDF's scope (valid or all) stays chosen at download.

## 5. Inline details and the task pane

### 5.1 Layout

- `TariffOverview` / `TariffCategorySections` render one rounded category table
  with unboxed summary rows. An opened detail has rounded bottom corners, the preceding tariff ends
  with rounded bottom corners, and the next tariff starts with rounded top
  corners. The last tariff has no trailing
  gap below its detail. Its five column headers remain
  available to assistive technology at narrow widths. The expanded summary keeps identity,
  warnings, title actions and the chevron; dates and prices appear in the detail.
  Shared columns align applicability, right-aligned prices and units. At narrow
  widths, overview validity follows prices. Category headings sit left of tables on wide overviews and above them
  at list widths up to 62rem or while the editing pane is open.
- The energy-type button opens the translated `form.energyTypeHints` explanation
  with keyboard or touch, without toggling the tariff. The disclosure closes on
  Escape and returns focus to its button.
- `TariffDetail` renders version groups labelled by their date ranges. Each rate
  group identifies its band and explicitly labels applicability, price and unit
  for assistive technology; it does not rely on the visual column headings.
  Identical nonempty notes across every version appear once as plain text under
  the tariff name, without an inline edit control. Different notes remain with
  their versions; their edit action is also available in the version menu.
  Charts and source information follow
  the version list. The tariff name and prices are not repeated.
- Closed current tariffs stay white; their chevron reacts on row hover/focus.
  An opened tariff's title row uses the dark green header surface and light text;
  its detail body stays white. The category outline disappears during expansion so it does not connect the separated rounded sections. Ended versions retain readable muted text.
  Keyboard focus retains its visible outline.
- Version history uses a named region in page flow, without nested scrolling,
  auto-scroll or a sticky header. Every version stays reachable by page scroll.
  At narrow detail widths the visual header is hidden; each date range sits
  above its labelled rates.
  On narrow screens, named bands place the name beside the price/unit pair,
  with the schedule below. Unnamed rate explanations and coverage warnings
  use the full width.
- Clicking an editable date opens its version correction; there is no passive
  date-selection action. Where dynamic versions need different source/history
  contexts, an explicit version selector sits beside price history. Choosing a
  different version of the same tariff does not refocus the tariff title or
  jump the page back up.
- Only an active editing task reserves the existing 28–34rem side column when
  at least 62rem of content width is available. On narrow screens that task
  temporarily replaces the list; cancelling/saving restores the expanded rows
  and scroll position, including wide→narrow and narrow→wide→narrow transitions during editing. While the task replaces the list, hide the page toolbar
  and overview description. The net-price/VAT explanation remains visible. The pane heading names the action, with
  the tariff name and source version dates below in smaller text. Resizing
  preserves the mounted form and draft.

### 5.2 Navigation

- `useTariffPaneNavigation` retains `tariff` / `version` and unrelated query
  parameters. Selection is the sole expansion state: opening another tariff
  closes the previous one. A rename resolves the tariff by its stable version
  ID and normalizes the name-derived URL key without discarding a draft.
  Reload restores that one linked tariff, never an editing draft.
- The first expansion pushes one history entry; switching tariffs or versions
  replaces it. Back returns to the preceding URL, and Forward restores the
  linked tariff/version. Collapsing the tariff returns through the marked
  history entry, or removes the parameters in place for a direct link.
- The history version selector does not open a task pane. Editing a value
  selects its own tariff/version before opening the task, including a value
  in a different version row.
- X, Cancel, Escape and the narrow Back to tariff control close the task only.
  Save selects the saved result in the inline details. Cancel restores focus to
  the invoking action, with the original tariff name/list heading as fallback.
- Dirty/saving tasks guard navigation, expansion/collapse, version selection,
  replacement tasks, deletion, import and user-requested community switches. Forced scope,
  permission or account changes clear tasks and expansions immediately.

## 6. Editing in the pane

### Tasks and actions

| Task | Initial values | Editable data | Save result | Cancellation |
|---|---|---|---|---|
| Correction | Clicked version/band | Validity, notes, permitted prices and recurrence; series identity is fixed | Keep the owning version selected | Guard changed or saving draft |
| Schedule price change | Current version, else nearest future/latest version | Business-date effective start, copied prices and recurrence | Select the created version | Guard changed or saving draft |
| Duplicate | Selected source version | New name, start date, prices and recurrence; retain a source end only when it follows the new start | Select the new tariff | Guard changed or saving draft |
| Rename | Series name | Name, applied to all versions | Retain selection and normalize its URL key | Guard changed or saving draft |
| New tariff | Creation defaults | Identity, validity and mode-specific pricing | Select the new tariff | Write nothing |
| New source | Source defaults | Source configuration | Return source to the retained tariff draft | Discard source task only |

The tariff title contains Schedule price change and a Rename/Duplicate menu.
Scheduling never derives its source from the last historical correction opened
or cancelled. Gap repair is the exception: it copies the chronological
predecessor and seeds the missing start date.

Each editable value/pencil is one button targeting its corresponding field.
Dates target `valid_from`, notes `notes`, amounts `price_chf_per_kwh`,
`percentage` or `fixed_price_chf`, and recurrence `period_type`; shared-fee
allocation targets `split_key`. Units and fetched prices are read-only.
Forms focus the target, selecting text/numbers. A fresh task remounts its draft.
Correction field order stays stable regardless of its trigger.

Version menus offer validity, applicable fixed-price/allocation corrections,
notes, Add price band, and one Edit band action per band. Band/version deletes
come last. Inline values remain direct shortcuts; viewers get no write controls.
An unpriced version renders one explanation with Add prices. Delete and import
use the draft guard. Confirming deletion closes tasks owned by that version;
confirmed import leaves the old task before opening its write flow.

### Creation and validation

Creation orders identity fields first, mode-specific pricing next, then validity
and notes. Static energy supports single-rate, daily HT/NT (07:00–21:00 /
21:00–07:00) and custom named bands. Editing a preset schedule switches to Custom;
replacing configured bands asks first. The [billing API spec](2026-03-tariffs-and-billing-engine.md#frontend-tariff-workspace-and-creation-api)
owns `initial_periods`, atomicity and audit behavior. Percentage/fixed/dynamic
creation retains its existing API contract.

Shared price/time/recurrence fields retain copied labels, weekdays and months.
Day and month choices stay visible in every band editor; correction forms also
show their fixed series identity without a disclosure.
Timed bands require both endpoints; flat bands ignore weekday/time restrictions,
hide those controls and preserve legacy values. Missing endpoints show translated
errors after submission, focus the first missing control and send no request.
A cleared required start date has an associated error. New-version/duplicate
starts use today's Europe/Zurich business date. Successor/predecessor previews
resolve chronologically, preserve a closed predecessor and show the calculated
end date read-only. Corrections explain that invoices are not recalculated.

### Coverage

Creation, scheduling, duplication and band edits share explicit coverage preview.
Finite versions check month/weekday pairs within inclusive validity; open-ended
versions check annual recurrence. Timed intervals are half-open; midnight/equal
endpoints, flat priority and type/start/id fallback match the billing engine.
Coverage does not change or block billing.

Expanded versions/forms name uncovered month/day/time ranges and the fallback
band and rate. Adjacent identical schedules merge; midnight bounds stay explicit.
Overlaps explain first-match resolution. Closed rows show a general warning;
repair appears only in the expansion and targets the incomplete or fallback band.
Viewers see explanations without repair. Historical warnings remain because
elapsed validity cannot establish finalized use of a static tariff version.

### Source tasks and async safety

Source creation temporarily replaces the visible tariff form in the same pane;
returning preserves its draft and focuses the source trigger. Source fields are
dirty-tracked. Discovery/saving lock fields and count as pending for page exits.
Source Cancel discards only that task; admin-modal X/Escape/scrim use the same
confirmation. Saved sources return without a discard prompt.

Scope/account/permission changes invalidate tasks. Submit and dispatch reject
obsolete sessions; late completion refreshes its original cache but cannot close,
lock or notify a replacement task. Failed cached refreshes keep the workspace,
draft and confirmation mounted. Retry does not reseed inputs. Navigation and
focus restoration follow §5.2.

### Dynamic inspection

Version rows lead with averages/reference windows, followed by source facts,
price history and a visible fetched-record table with 12 rows per page.
Pagination retains access to every fetched record. Source loading/failure/unavailability is shown rather than silently
omitting history. Even one fetched interval has a visible point.

Date controls enforce tariff bounds. An inverted range has one error beside the end date and
sends no request. Elapsed missing intervals appear after filters and before the
chart, with inclusive Swiss dates, visible exact boundaries, and their invoice
blocking consequence. Adjacent/overlapping affected days merge; future gaps are
excluded and a gap crossing now is clipped. Future-only unavailable prices retain
`—`. History errors offer Retry. Charts span the selected civil days, label CHF/kWh,
shade/break gaps and retain negative values. Fetch success and automation status
are separate from price coverage.

## 7. Forms, saving and errors

Reference spec §8 applies: validate on submit then on correction, field errors by
the field, a persistent `Notice` for non-field failures, visible pending state
with values readable, no duplicate submission, retained form on failure. A
pending save that outlives the pane applies only to its originating scope and
editing instance.

## 8. Pilot acceptance

Use realistic data: a simple fixed fee, current plus scheduled prices, a
historical entry, a genuinely disabled action, multiple bands, and an extensive
dynamic tariff. Check ordinary laptop widths, about 400px, and the chosen layout
boundary.

| Scenario | Required observation |
|---|---|
| Overview hierarchy | One row per current/upcoming tariff, dated next-price control, then entirely ended tariffs; earlier versions in the expanded row; correct displayed prices; no gratuitous counts |
| Historical / disabled | Grey but readable history; a separate explicit reason for true disablement |
| Wide layout | Inspection uses full-width expanded rows; only editing adds a side column |
| Narrow layout | Inspection stays inline; task exits restore expanded rows; no horizontal overflow |
| Comprehension | Short labels only where needed; touch- and focus-accessible explanations; long translations wrap |
| Selection | Direct links and reload show the intended series and version; Back/Forward and task exits keep the list state |
| Editing | Prefilled fields in the secondary task pane; Save and Cancel return to viewing, the table stays available; a layout change keeps the draft |
| Save / failure | Visible pending state, no duplicate submit or lost late edits, result selected; values and error stay on failure |
| Dirty dismissal | X, Cancel, Escape, Back, navigation and tariff/version selection are guarded; staying keeps draft and selection; reload warns; explicit discard resets |
| Scope / async | Old-scope data cleared; late completions cannot select or reopen unrelated detail or replace a newer edit; rename keeps selection |
| Creation | The three creation cases of §6 fit, or the exception is recorded |
| Keyboard | Named row controls, correct focus targets, no pane focus trap, picker Escape before parent, modal manager ownership intact |

Screenshots serve human review; browser assertions prove keyboard operation,
inertness and restoration. Focused tests live near the tariff and dialog tests.
Run the frontend CI commands listed in the reference spec §12.

## 9. Documentation to update with the implementation

- `2026-03-tariffs-and-billing-engine` (screen behaviour),
  `2026-04-frontend-management-page-design` (pane, shared components),
  `2026-08-ui-redesign-pdf-style` §15.3 (the tariff list and its filter tabs),
  and `2026-03-community-and-access` if URL or history behaviour is documented
  there.
- The matching user-guide chapter and its screenshots, regenerated as a set.
- ADR 0040 moves to Accepted when the acceptance in §8 passes.

## 10. Risks

| Risk | Mitigation |
|---|---|
| An editing task is cramped on a laptop | Real-width validation; task replaces list when two columns cannot fit |
| Back or X loses the user's place | Test X, Back, Forward and reload; list state preserved |
| Grey history reads as disabled | Readable text, explicit context, accessible corrections; disablement explained separately |
| Creating a many-band or dynamic tariff does not fit a pane | Go/no-go in §6; page for that task only |
| A late save lands in the wrong scope | `useWriteScope`; clear on scope change |

## 11. Pilot decisions and validation

| Decision | Outcome |
|---|---|
| Inspection container | Inline expansion is the tariff pilot's exception to the general viewing-pane proposal. |
| Editing container | Focused task forms use a 28–34rem pane when space permits; otherwise they replace the list. |
| Creation acceptance | Fixed-fee, atomic HT/NT, six-band and dynamic-source creation remain required workflows. |
| Dialog sizing | Unchanged by this pilot; the proposed shared dialog migration is separate work. |

Automated checks cover draft/scope guards, stale completions, field focus,
initial-band validation, nested error indexes and the responsive workspace.
Browser scenarios cover 1440px and 400px layouts, history navigation, refresh
failures and EN/DE/FR/IT forms. Run results and the tested commit belong in the
branch review bundle. Record the frontend lint, style/color/token checks, unit
tests and build, the affected Playwright workflows, and strict MkDocs results.
The six tariff browser suites run in the PR Quality CI job against a built
frontend and mocked APIs, without backend login/setup. Run them locally with
`SCREENSHOT_BASE_URL=http://localhost:5173 npm run test:browser -- --no-deps screenshots/tariff-*.spec.ts`
after starting the frontend; their API fixtures use empty authentication state.
The editing-session suite owns draft guards, mutation lifetimes and breakpoint
restoration; expansion owns Back/Forward; presentation owns rate rendering and
long histories; UX owns creation, coverage and validation; usability owns preset
and comparison interactions; workspace owns action placement and context.
Shared sidebar acceptance should move to shell tests when that work is separated.
Regenerate the user-guide screenshots as a set after UI changes. Spoken screen-reader output
remains a manual acceptance check; labelled groups and accessibility-tree checks
do not substitute for that verification.
