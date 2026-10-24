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
- Impacted Areas: frontend, docs

---

Tariff details expand inside their category table, within the existing tariff
row, on desktop and narrow screens. The former viewing sidebar has been removed;
only focused creation/editing tasks use the in-flow side pane. This supersedes
the tariff pilot's original list-and-detail layout and is an explicit exception
to the proposed reference-spec §5/§6.2 viewing-pane rule. Billing, API shapes,
permissions and the forms' validation semantics are unchanged.

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

- Billing and tariff calculation, versioning semantics, API shapes and permissions.
- The tariff overview PDF and its scope choice at download (unchanged).
- Other drawers, wizards and dialogs (later phases of the rollout).
- Billing's layout. The tooltip rule in §4 should guide it when it is next revisited.

## 3. Actors, permissions, and ZEV scope

Unchanged. A viewer reads only: no Edit, version, rename, duplicate, delete or
band controls (#761), but the same inline details and warnings. Scope and access
changes clear the selection, expanded rows, task pane and any draft immediately; an obsolete
completion must not select or reopen anything (`useWriteScope`, reference spec §3).

## 4. Overview

**Files to start from:** `TariffsPage.tsx`, `useTariffPaneNavigation.ts`,
`useTariffEditor.ts`, `TariffCategorySections.tsx`, `TariffPricesCell.tsx`,
`TariffDetailPane.tsx`, the tariff forms, `useTariffCrud.ts` and
`useTariffVersions.ts`. The route and scoped series endpoint are unchanged.

- Show one combined table of current and upcoming tariffs, then **Ended tariffs**,
  keeping the energy / grid fees / levies / metering category order inside each.
  This replaces the `FilterTabs` Valid / Upcoming / All view (`TariffListView`).
- Each series appears once, using the version valid today or the nearest future
  version if none is active. Planned prices sit on the left under from-date;
  current prices sit on the right under Today. The version’s validity stays
  in the date-range column on the left; an end date is not repeated above prices. Planned prices are directly
  selectable, with quiet backgrounds. The extra planned column and changed-schedule
  control are hidden whenever the list is at most 56rem wide; current prices use a single column without reserved comparison
  space. Future-only tariffs retain their sole price. Scheduled versions remain
  accessible in the expanded row. Versions without prices have no planned
  price control. Matching applicability and units, in the same order, allow
  aligned band comparisons; otherwise an explicit prices/schedule-change action
  opens the future configuration. This avoids implying a band match. Ended
  tariffs contains only series without current or scheduled versions. Earlier versions of active/upcoming series live in the expanded row. The
  downward chevron, name and row expand the tariff; the upward chevron, name
  and row collapse it regardless of which version is shown. Independent action
  buttons and selected text do not toggle the row. Opening another tariff closes the previous expansion. Each tariff remains exactly one `tr`. Expanding replaces its compact
  cells with one `td colSpan={6}` containing the tariff title and aligned version
  blocks spanning the full sheet width, with a stable `aria-controls`
  target and a labelled validity region. No second tariff row, heading, nested
  price table or repeated summary is rendered. No sidebar opens for
  inspection or version selection.

- Opening a tariff selects the version valid today, without changing the
  version blocks’ newest-first chronological order. An explicitly selected past
  or future version stays selected and is clearly identified. The version blocks stay visible; price charts appear only with changing prices;
  technical source details and fetched interval records remain on demand.
  Important warnings stay visible.
- Historical rows are grey but readable, with explicit historical context. They
  stay accessible and can expose permitted corrections: past does not mean
  disabled, and a genuinely disabled record or action says why.
- Plain validity dates, not rounded validity pills. No tariff, fee, band or
  version totals unless they help a concrete task (reference spec §10.1).
  Warnings beside the name stay: a gap, a failed price fetch.
- Follow the participants/invoices table treatment: sheet header, aligned
  columns, row separators, action hierarchy. The list reflows by container
  width: a table where it fits, compact rows with identity beside prices between
  40rem and 56rem, and stacked rows below that. Compact price headings use their
  own line height; repair actions use the shared compact button style without repeated warning copy.
  Prices, units and their bands or schedules stay together; add short visible
  labels only where the values are unclear once headers disappear.
- Tooltips explain ambiguous or truncated information but are supplementary:
  essential meaning is available on touch, and explanatory interactions also
  work with the keyboard.
- Rows have a named, keyboard-accessible control that expands the row (the name
  button, as today); row click is an extra. The tariff overview PDF's scope
  (valid or all) stays chosen at download.

## 5. Inline details and the task pane

### 5.1 Layout

- `TariffOverview` / `TariffCategorySections` keep one table row per tariff
  both collapsed and expanded. A collapsed row uses the normal overview cells.
  An expanded row uses one `td colSpan={6}`. The left identity column stays at
  26% on wide screens; its tariff title and record menu sit in the shared dark
  green header, aligned with Date range / Applies / Price / Unit to their right.
  Energy type and warnings remain in the left body column. The close chevron
  sits at the right end of the shared header. When the first row opens, the
  category header merges into this bar, with the category above the tariff name;
  the original column labels remain accessible and retain their column widths.
  There is no nested version table or framed detail card. Below 56rem of list
  width, the identity and pricing columns stack.
  Category titles always use `--brand-accent`, matching the category label in
  an expanded tariff's header, whether any tariff is open or closed.
- While a tariff is expanded, the other current tariffs use a soft neutral
  background across categories. Hover or keyboard focus restores their white
  background. Ended tariffs retain their darker grey treatment. The expanded
  tariff stays white, and collapsing it restores the normal overview colours.
- `TariffDetail` (in `TariffDetailPane.tsx`) renders version blocks beneath that
  shared header, with scheduling, gap actions,
  charts and source information below. Each version's note appears below its own
  date range; notes are readable directly rather than switching a remote sidebar
  or identity-cell paragraph when a version is selected. Collapsed rows retain
  their listed version's short note. The title and prices are never duplicated.
- The version list uses normal page flow instead of an independently scrolling
  box capped at five rows. Expanded content remains in the existing category
  sheet. Below 30rem of detail width, each date range and note sit above that
  version's bands, while Price and Unit remain aligned.
- Date selection still chooses the version used by the source/history context
  and scheduling, but selecting another version of the same tariff does not
  refocus the tariff title or jump the page back up.
- Only an active editing task reserves the existing 28–34rem side column when
  at least 62rem of content width is available. On narrow screens that task
  temporarily replaces the list; cancelling/saving restores the expanded rows
  and scroll position. Resizing preserves the mounted form and draft.

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
- Selecting a version does not open a task pane. A task action selects its own
  tariff/version before opening, including an action in a different open row.
- X, Cancel, Escape and the narrow Back to tariff control close the task only.
  Save selects the saved result in the inline details. Cancel restores focus to
  the invoking action, with the original tariff name/list heading as fallback.
- Dirty/saving tasks guard navigation, expansion/collapse, version selection,
  replacement tasks and user-requested community switches. Forced scope,
  permission or account changes clear tasks and expansions immediately.

## 6. Editing in the pane

- Selecting a tariff expands its details. **Edit** opens the secondary task
  pane with prefilled fields; the expanded tariff remains the owning context. Only
  fields the API already permits are editable; immutable identity fields keep
  their restrictions.
- The tariff's record menu in the category/identity cell contains Rename and
  Duplicate, visible only while expanded. A version is the parent of its
  recurring price bands (`TariffPeriod.tariff` points to that dated `Tariff`).
  The UI therefore puts its validity window on the left, followed by band
  applicability, price and unit. **Zeitraum** means the version's dates;
  **Preisband** means the recurring HT/NT/custom band, avoiding Periode for both.
- Hovering the date range or its version’s band/applicability content reveals
  the same correction pencil in the date cell; hovering a band also reveals its price pencil within the existing numeric cell. Both also reveal on
  keyboard focus and stay visible on coarse-pointer/touch devices. A compact
  reserved gutter prevents layout shifts. Date corrections use the existing
  version editor; a static or percentage price pencil edits its owning band;
  a fixed-fee pencil opens its version correction. Fetched prices stay read-only.
- The version menu retains band deletion, Add price band and Delete version;
  editing no longer requires that menu. Destructive confirmations, disabled
  states and permissions are preserved. An unpriced version keeps Add prices.
  Schedule price change appears once below the periods. All editing uses the
  existing focused task pane with the selected version/band as context.
- **Save** returns to viewing on the saved tariff or version. **Cancel** returns
  to the original viewing context, asking before discarding changed values.
  Cancelling creation restores the previous selection, or the list if there was
  none.
- User-requested community changes run the pane’s dirty/saving guard before
  selection or account-preference mutation; keeping the draft keeps scope.
  Forced account/permission/scope changes still clear old-scope data immediately.
- The dirty guard (reference spec §6.2) covers X, Cancel, Escape, browser Back,
  navigation and selecting another tariff or version. Staying keeps the draft
  and the original selection. Confirmations use the modal manager; the pane
  itself stays non-modal.
- Each version shows its own note beneath its dates. There is no repeated tariff heading, nested price table or separate Prices
  section. A dark green header labels Date range / Applies / Price / Unit above the
  white version list. Selected dates use stronger type, with no green sideline
  or tinted fill. Past periods use grey text; Current/Ended labels are omitted.
  Future periods have a small clock icon with an accessible Upcoming label
  beside the dates, without a coloured date box. The scrollable version region retains **Validity periods**
  (DE: **Gültigkeitszeiträume**) as its accessible name. Passive version content has no click handler or hand cursor. The explicitly
  named date button selects a version for the chart, source and scheduling context;
  its note is already visible alongside its dates. The action menu does not also select the block or collapse the
  tariff; its accessible label includes the validity dates. Cancelling an edit
  returns focus to its pencil; menu tasks return to their menu trigger. Actions target their own version; saving a band
  selects its owning version through the submitted tariff ID.
  Each version displays its own rate lines from `useTariffDisplay.rateLines`:
  band applicability, prices and units; percentage shares and derived prices;
  dynamic averages with their reference window; or fixed fees with their basis
  and frequency. Dynamic averages are not repeated in a separate summary
  section; their fetched history and source details remain below the version blocks.
  Static rate lines map to the same-order `version.periods`
  entries for their edit/delete targets. A missing-band row retains the
  incomplete-pricing explanation and Add prices action. Schedule price change
  sits below the version blocks and copies the selected version. All versions and their notes use normal page scrolling.
  The editor keeps its correction heading and explanation.
  Correction explains that it changes an existing period without automatically
  recalculating invoices. Date ranges identify the version blocks, with a clock for future periods; the editor exposes its version’s validity fields.
  Internal tables retain the shared high-contrast header treatment.
  Duplicate/scheduled-change price rows use plain band labels and aligned,
  equally wide numeric inputs, including at narrow widths.
  **Schedule price change** is the prominent task-oriented action for future
  prices; ordinary corrections remain separate. Show the effective-date picker
  beside its label and the editable prices below it. A successor determines the
  end date: show that date in a read-only Valid to field with an explanation.
  Do not repeat the chosen start date or prices in a summary; retain the
  predecessor end-date preview where applicable.
- After a create or a scheduled change, select the resulting tariff or version.
  Rename keeps the selection and updates the name-derived series key in the URL.
  No billing or versioning semantics change. Its live date preview resolves
  the chronological predecessor/successor independently of the chosen source
  prices and preserves an already-closed predecessor. A gap action seeds the
  missing start date and copies the preceding version for review. New-version
  and duplicate forms expose both times for each non-flat band. Missing times
  show translated required-field errors and prevent submission until supplied;
  they are never inferred from legacy bands. The matching server validation
  error is translated through the shared tariff error formatter (DE/EN/FR/IT).
- **Creation field order.** Name, category and billing mode form one vertical
  sequence. Mode-specific fields follow that choice. Energy mode puts the source
  selector before energy type (editable for manual bands, a derived value for a
  selected source), then any feed-in minimum. Percentage mode shows energy type
  and initial percentage. Energy type has a plain inline explanation matching
  the selection or source-derived value (within-ZEV energy, grid imports or
  surplus feed-in compensation). Fees show the amount and, for shared fees, split key
  with its explanation below. Validity follows in a responsive pair, then compact
  notes. A selection never changes the visible fields above it. Manual creation
  shows its initial band fields below the source/energy-type choices, without an informational warning banner.
  Creating a source temporarily hides the mounted tariff form and its footer;
  the source task uses its own sibling form in the same pane. Returning restores
  the tariff draft and focus to the source-creation button.
- **Source task lifecycle.** All editable source fields participate in dirty
  tracking. Source Cancel confirms discarding that task only; successful save
  returns without a discard prompt. Discovery and saving lock fields and count
  as pending in the page guard, including on community switches. Focus enters
  the source form and returns to its trigger. Cache invalidation survives task
  dismissal; stale UI callbacks do not. `useEditingSession` is shared with tariff
  and version writes; `useTariffEditor` owns the one active pane task.
- Validation errors are translated and associated with their fields, including
  a cleared required start date. An unmapped schema error has a fallback notice.
  Individual price-band edits require both time endpoints for `high`, `low`
  and `band`, with translated errors at the time pickers. Invalid submission
  keeps the editor open and sends no request; `flat` allows blank times.
  Flat/timed-band month conflicts returned by the API are translated through
  `features/tariffs/errors.ts` for tariff creation, band edits, scheduling and
  duplication, without exposing `period_type` or the raw English diagnostic.
- Dynamic history renders even one price interval with a visible point. Source
  loading/error states are shown instead of silently omitting history.
- **Static energy creation.** One draft contains identity, validity and initial
  bands. Single-rate and editable daily HT/NT (07:00–21:00 / 21:00–07:00)
  presets precede their fields; custom schedules allow additional named bands.
  Weekday/month selectors retain their existing semantics. Create tariff sends
  `initial_periods` in one atomic request; Cancel writes nothing. Existing
  unpriced versions keep a direct Add prices action. Percentage,
  fixed-fee and dynamic creation keep their existing API semantics.
- **Coverage preview.** Creation, scheduling/duplication and individual band edits
  check the explicit annual schedule across all weekdays and months. Timed
  windows are half-open, midnight wrapping and equal endpoints follow the billing
  engine, and flat bands ignore weekday/time restrictions. Missing explicit
  coverage names the actual fallback band, its price or percentage, and the
  affected months, matching the backend's type/start/id order and seasonal
  preference. The overview shows the fallback explanation under the tariff
  identity in the left column, with an inline red exclamation icon and text;
  complete schedules show no overview notice.
  Overlapping windows explain
  first-match resolution. The preview does not change or block billing rules.
- **Repair and compact rows.** Writers can open the first-price or missing-window
  editor directly from the overview. Gaps between complete windows also offer
  **Review time window**, opening a fallback band's editor. Viewers see the
  coverage explanation without a write action. Partial dynamic summaries have a visible
  warning link with the same red exclamation icon, left alignment, spacing and
  body text style as the coverage warning; the text remains a keyboard-accessible
  button that opens details. Compact
  rows omit notes, retain band/price typography, and keep the extra price column
  hidden. Upcoming versions remain selectable in the expanded validity list;
  there is no redundant next-change text link in the overview.
  Row clicks ignore selected text. Full-width Ab/Today order stays unchanged.
- **Dynamic inspection.** Average/reference period lead the body, followed by
  actions, price history, source facts and version history. Confirmed missing
  stored intervals in elapsed time appear before the history filters/chart, with
  inclusive Swiss dates and expandable exact boundaries. Intervals starting at
  or after now are excluded from the warning; one spanning now is clipped to its
  elapsed part. A future tariff with no prices has a normal unavailable-prices
  message. The warning explains that needed missing
  dynamic prices block generation; it does not claim zero billing or late
  publication. The chart labels CHF/kWh, spans the selected Swiss civil-day range,
  shades gaps and breaks the line across them, retaining negative values and a
  zero reference. Source fetch success and automation remain separate facts.
- **Go/no-go for creation.** Test realistic creation before committing: a simple
  fixed fee, a many-band tariff, and a dynamic tariff that needs a dynamic
  source (today `TariffFormModal` opens `DynamicSourceFormModal` over itself;
  the pane has no second dialog, so the source becomes an inline section). If a
  creation task does not fit a pane, that task alone moves to a page; it is not a
  reason to keep the overlay for everything.

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
inertness and restoration. Add focused tests near the tariff and dialog tests
(this document does not claim they exist). Run the frontend CI commands listed
in the reference spec §12.

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

## 11. Implementation record

Values and decisions the pilot produced (reference spec §13, open question 3).

| Item | Outcome |
|---|---|
| Pane width | `minmax(28rem, 34rem)` beside a flexible list. |
| Dialog sizes | Not confirmed here: the pilot removed three tariff dialogs (create/edit, version, band) rather than sizing them. The provisional `FormModal` sizes stay provisional until phase 4. |
| Table treatment | Category sheets and container reflow; normative behavior is in §4. |
| Expansion navigation | Opening from the list pushes one entry marked `state.tariffPane`; collapsing the linked row takes it back with `navigate(-1)`. A direct link has no such entry, so collapse removes the parameters in place. Switching tariff or version replaces the entry and keeps the marker. A link to a tariff that no longer exists clears the parameters. A renamed tariff is found by the version in the URL, which the page then rewrites to the new name. |
| Escape / X | Close only the editing task (guarded), preserving the inline detail. Picker/menu Escape is left alone when already handled. |
| Dirty guard | `useDraftGuard`: pane actions (`run`), the router blocker for Back/Forward and links, `beforeunload` for reload. A save in flight counts as unsaved and the prompt says it may still complete. Scope, permission and account changes clear the selection and every draft without asking. Phase 2 moves the pane-independent part into `FormModal`. |
| Saving | Fields lock during writes; scope and editing-session checks ignore stale UI completion. See §6. |
| After a save | Create and duplicate select the saved tariff; schedule price change and rename select the saved version inline, an edit stays on its version; the task pane closes and focus returns to the action or original tariff name. Cancel returns focus to the control that opened the form (`data-action-key`). |
| Go/no-go for creation | Fixed-fee and atomic HT/NT checks passed. Six-band creation and source-backed dynamic creation also passed against the live backend; temporary records were removed. Spoken screen-reader output remains a manual acceptance check. |
| Static energy setup | Browser tests cover atomic HT/NT creation at 1440px/400px, cancellation without a write, direct legacy repair, and six-band creation at 400px in EN/DE/FR/IT. |
| Duplicate | The spec did not name it; it follows rule A and is a pane form like schedule price change. Rename has its own focused form. |
| Header | The page actions (import, overview PDF, New tariff) moved from a toolbar card into the page header, since the toolbar only held the tabs besides them. |

Browser checks of the acceptance table (laptop and phone widths, navigation,
dirty guard, create/rename/delete round trip) were run by hand against the dev
stack; the keyboard, inertness and restoration behaviour is covered by
`tariff-draft-guard.test.ts`, `tariff-detail-pane.test.ts`,
`tariff-overview-list.test.ts`, `tariff-write-scope.test.ts` and the Playwright
specs `tariff-presentation.spec.ts`, `tariff-editing-session.spec.ts`, `tariff-ux.spec.ts` and
`hub-workflow-links.spec.ts`. The workspace follow-up also covers HT/NT setup at 1440px and 400px,
dated current/future prices, width-dependent comparison hiding, future-only pricing, inline expansion and chevron closure, guarded community switching and mobile
navigation focus containment. Narrow rate labels are checked in English,
German, French and Italian. Forced-colours rendering was visually checked in
the live stack at 400px. Six-band creation, scheduling and source-entry forms
are exercised at 400px in EN/DE/FR/IT, including labelled accessibility-tree
controls and keyboard focus. Spoken screen-reader output remains unverified. The latest design iterations have not been validated or captured: tests,
screenshots and automated validation are paused at the user’s request. Earlier
runs and guide captures describe earlier layouts, not this current snapshot.
