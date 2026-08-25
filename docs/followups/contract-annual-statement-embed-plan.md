# Contract & Annual Statement PDF Embed — Implementation Plan

- Branch: `followup/contract-annual-statement-embed` — base `feat/ui-print-parity`
- Companion note: `docs/followups/contract-annual-statement-embed.md`
- Status: implemented 2026-08-25.
- All references below verified against the branch tip at planning time.

## Goal

`PdfPreview` (real-PDF embed via authenticated blob fetch) currently exists only on
`InvoiceDetailPage` and `AdminPdfTemplatesPage`. Extend the same pattern to:

1. The participant contract PDF (`GET /api/v1/zev/participants/{pk}/contract-pdf/`).
2. The annual statement (`GET /api/v1/invoices/invoices/annual-statement/?year=…`).

Both endpoints answer with `Content-Disposition: attachment`, so embedding must go
through a blob fetch → `URL.createObjectURL` (never a raw iframe `src`).

## Current state (verified)

- `frontend/src/components/PdfPreview.tsx` — presentational only; caller owns the
  authenticated fetch, object-URL creation and `URL.revokeObjectURL` on unmount.
- `frontend/src/pages/InvoiceDetailPage.tsx:13` — `useInvoicePdfUrl(invoiceId, hasPdf)`
  is the reference implementation (loading/error state, 401-refresh via api client).
- Contract PDF today is download-only:
  - `frontend/src/lib/api/zev.ts:90` `downloadParticipantContractPdf()` (blob → `downloadBlob`).
  - Triggered from `frontend/src/pages/ParticipantsPage.tsx:232` (`downloadContract`),
    button in `frontend/src/features/participants/ParticipantCardsSection.tsx:157`.
- Annual statement today is download-only:
  - `frontend/src/lib/api/invoices.ts:91` (single) / `:102` (zip).
  - Dashboard card: `frontend/src/pages/DashboardPage.tsx:458-486` (year picker,
    single + "download all" zip).
- Backend endpoints: `backend/zev/views.py:355` (contract), `backend/invoices/urls.py:31-32`
  (`AnnualStatementView`, `AnnualStatementsZipView`).

## Steps

1. **Extract a shared blob-fetch hook.** Move the `useInvoicePdfUrl` pattern from
   `InvoiceDetailPage.tsx` into a reusable hook (e.g.
   `frontend/src/lib/usePdfObjectUrl.ts`) taking a fetcher `() => Promise<Blob>` plus
   an `enabled` flag; returns `{ url, loading, error }`; revokes on unmount / URL change.
   Refactor `InvoiceDetailPage` to use it (behaviour-preserving).
2. **Contract embed.** In the participant detail area (`ParticipantCardsSection` /
   where the download button lives), add a collapsible/sectioned `PdfPreview` that
   fetches `/zev/participants/{id}/contract-pdf/` as a blob. Keep the existing
   download action as-is (embed complements it, doesn't replace it).
3. **Annual statement embed.** On the Dashboard annual-statement card, add an inline
   preview for the single-participant statement for the selected year. The zip
   ("download all") stays download-only — a zip cannot be embedded.
4. **Permissions.** No backend change: contract-pdf and annual-statement already
   enforce self-service vs owner/admin scoping server-side. Verify the embed surfaces
   only where the download action already appears (same audience).
5. **i18n.** Reuse existing `pdf.*` keys where possible; add any new labels
   (e.g. "Preview contract", "Preview statement") to all four locales
   (`frontend/src/i18n/locales/{de,en,fr,it}.ts`). No hardcoded strings.

## Tests

- Hook test (`frontend/tests/use-pdf-object-url.test.ts(x)`): URL created from blob,
  revoked on unmount, error flag on rejected fetch. Note: vitest currently includes
  only `tests/**/*.test.ts` — component/hook rendering tests need the include pattern
  extended and `@testing-library/react` added (coordinate with
  `followup/datatable-tests`, which needs the same).
- Manual: preview + revoke across route changes (no leaked object URLs).

## Validation

- `npm run test:unit`, `npm run build` in `frontend/`.
- Manual on docker compose: contract preview renders for owner; participant sees their
  own; error banner on 404 (no broken iframe); same for annual statement.

## Spec/doc updates

- `docs/specs/2026-08-ui-redesign-pdf-style.md` §6.2 (deferred embeds) — mark done.
- `docs/specs/2026-08-contract-pdf-redesign.md` — note the embed surface if it lists
  contract PDF consumption paths.

## Risks & decisions

- Object URLs + TanStack Query: keep the fetch in the hook, not in a query cache
  (blobs don't serialize); accept refetch on remount.
- Annual-statement generation can be slow for large ZEVs — reuse the loading state,
  don't block the page.
