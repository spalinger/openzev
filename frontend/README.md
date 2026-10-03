# OpenZEV frontend

React + TypeScript + Vite single-page application for the OpenZEV energy
community management platform. See the root `README.md` for full-stack setup;
this file covers frontend-only development.

## Stack

- React 19, TypeScript, Vite
- TanStack Query for server state
- react-i18next for localization (EN/DE/FR/IT)
- Mantine for components (shared `DataTable` built on `@tanstack/react-table`), Recharts for charts
- Vitest for unit tests, Playwright for user-guide screenshots

## Local development

Use the Node version pinned in `.node-version` (currently 24.20.0).

```bash
npm install
cp .env.example .env   # set VITE_API_BASE_URL (see root README)
npm run dev            # http://localhost:5173
```

The dev server proxies API requests to the backend; the API URL comes from
`VITE_API_BASE_URL` in `.env`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) + production build to `dist/` |
| `npm run lint` | ESLint |
| `npm run test:unit` | Vitest unit tests (one-shot) |
| `npm run test:unit:watch` | Vitest watch mode |
| `npm run screenshots` | Playwright: regenerate user-guide screenshots into `../docs/user-guide/screenshots/` |
| `npm run preview` | Serve the production build locally |

## Project layout

- `src/pages/` — route components
- `src/features/` — domain-scoped hooks, forms and components (invoices,
  tariffs, metering points, participants, feasibility, admin)
- `src/lib/` — shared utilities, API client and date helpers
- `src/i18n/locales/` — translation files (all user-facing text must go
  through i18n; never hardcode UI strings)
- `src/types/api.ts` — API contract types (keep in sync with the backend
  serializers)
- `tests/` — unit tests
- `screenshots/` — Playwright configuration used by `npm run screenshots`

## Design mockups

Eight interactive design concepts are available in the separate
`/design-lab.html` Vite entry, with complete navigation for managers,
participants, admins, and viewers, four languages, and a 400px preview. Sample
pages cover overview, energy, billing, participants, accounts, and settings;
additional destinations have empty pages. They use fictional data and do not
connect to the API.

Open [`../design/mockups/index.html`](../design/mockups/index.html) directly in a
browser for the portable version. Regenerate it with `npm run mockups:build`.
See [`../design/mockups/README.md`](../design/mockups/README.md) for the concepts,
interactions, and source locations.

## Conventions

- Prefer small, targeted changes; preserve existing style and naming.
- Update `src/types/api.ts` when backend response shapes change.
- When changing API behavior, update backend tests and frontend consumers
  together.
