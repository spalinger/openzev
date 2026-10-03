# OpenZEV design explorations

Open **[index.html](index.html)** in a browser. This self-contained file includes
the code, styles, icons, and fonts; it needs no server, login, internet connection,
or backend. It opens with a gallery of all eight concepts.

| # | Concept | Direction |
|---|---|---|
| 01 | Blue sidebar | Familiar navigation; period work beside billing checks |
| 02 | Compact tables | Short rows, text navigation, monospace amounts, continuous surfaces |
| 03 | Open layout | Top navigation, fewer containers, larger chart, generous spacing |
| 04 | Dark workspace | Rectangular navy surfaces, energy chart beside open billing items |
| 05 | Billing workspace | Period and invoices in one work column; persistent checks alongside |
| 06 | Split view | Invoice list and selected document side by side; no repeated KPI cards |
| 07 | Invoice · green | Helvetica, circular mark, fine green rules, forest table headers, pale zebra rows |
| 08 | Invoice · blue | The same print grammar in blue, with navigation outside a white document surface |

Select a layout and use **View as** to change the preview persona. The gallery
also previews every layout for the chosen persona. Layout switching preserves
the current screen. **Mobile** previews a 400px layout. The address preserves
layout, persona, community, screen, and viewport. All copy is available in
EN/DE/FR/IT. Headings and actions use functional labels; there are no taglines,
design pitches, decorative avatar groups, or introductory banners.

## Views and scope

| Preview | Navigation and data | Actions |
|---|---|---|
| Owner / manager | Complete community menu, including Setup and Feasibility; switch between two managed communities | Approve drafts, simulate sending, record payment, edit participant contact details, load missing sample readings, save settings |
| Participant | Dashboard, My invoices, Annual statement; own account through the header | Inspect own invoices and consumption; no approval, sending, or payment-status controls |
| Admin | Complete community menu plus the four-entry Platform group, visible in both scopes | Open a community to use the management workspace; platform entries return to platform administration |
| Read-only manager | Community management navigation and records | Inspect records and documents; no write controls |

The design uses one shell with navigation based on access to the current
community. **View as** is a comparison control outside the app. It represents
different accounts, not a proposed permission switch. Owners/managers and
viewers correspond to community grants; only admin is a platform role in the
current product. Admin pages name platform scope; community pages name the
selected community. Participant invoices contain only the participant's own
issued records. Unsupported page/scope combinations in copied addresses fall
back to an allowed view.

Sidebar, topbar, and quick-navigation menus match
`spalinger/ui-sidebar-labels` (`2879270b`) in all four languages, including
entries whose pages have no sample content:

- Community: Overview, Energy balance, Metering, Billing, Reports.
- Setup: Participants, Metering Points, Tariffs, Settings.
- Feasibility (assumed enabled for this comparison).
- Platform, for admins: Overview, Accounts, Templates, Settings.
- Participant: Dashboard, My invoices, Annual statement.

Admins see all 14 entries regardless of the current scope. Community entries
open the selected community, or Sonnenhof from platform scope; platform entries
switch to platform scope. ZEVs and Invoices are tabs of the platform Overview
hub. New destinations show only their heading and an empty page. Menu groups
wrap in the top-navigation layouts; vertical sidebars can scroll, and narrow
layouts retain the full menu in a horizontally scrollable navigation strip.

Billing supports search, status filters, selecting and approving eligible
drafts, invoice detail, simulated sending, and recording payment. Batch approval
applies to selected visible drafts, or all eligible visible drafts when nothing
is selected. Limmatblick starts with two missing meter readings: approval is
unavailable until the manager loads sample readings on the Energy balance screen.
Participant contact edits do not rewrite existing invoice recipients. Daily and
weekly chart controls change the aggregation. The header search and Ctrl/Cmd+K
open navigation limited to the account's menu. Dialogs support Escape.

All records are fictional. Actions affect browser memory only. Changing layout,
persona or community, returning from the gallery, or reloading resets them.
The three sample communities contain 6, 4, and 3 participants. The document
panel is an illustrative summary, not an issued PDF or payment request. Its
layout follows `backend/templates/pdf/shared_pdf_base.html` and the invoice
template: Helvetica, circular community mark, light invoice number with bold
suffix, recipient/fact columns, green table header, zebra rows, and ruled total.

## Source and regeneration

Use the Node version in `.node-version`. From `frontend/`:

```sh
npm ci
npm run mockups:build
```

The generated file is included for convenient review. Edit
`frontend/src/design-lab/`, `frontend/src/i18n/locales/designLab.ts`, and
`design/tokens.json`, then regenerate it. Token edits also require
`node scripts/generate-tokens.mjs` from the repository root.

For hot reload, run `npm run dev` and open `/design-lab.html`. The normal
production build also emits `dist/design-lab.html` as a separate entry. The
prototype does not import the product's auth, API, or settings providers, and
does not replace product screens or navigation.

## Screenshots

After regeneration, `npm run mockups:capture` from `frontend/` captures the
gallery and every layout/persona at desktop and mobile widths into
`screenshots/`. It checks every available screen at 400px, including admin
community scope, and reports browser errors. It requires a working Playwright
Chromium installation; use
`DESIGN_LAB_BROWSER=/path/to/chromium` to select another executable.

The restricted agent session could run the build and DOM interaction checks,
but blocked local server sockets and Chromium's IPC calls. Browser screenshots
and visual verification must be run outside that session.
