# Contract & Annual Statement PDF Embed

Deferred from SPEC-2026-08 §6.2.

PdfPreview is only on InvoiceDetailPage & AdminPdfTemplatesPage. Embed on:
- Contract detail: blob-fetch GET /api/v1/zev/participants/{pk}/contract-pdf/
- ~~Annual statement download page~~ **Done**: the annual statement UI moved
  from Dashboard to ReportsPage upstream; the reports page now has an inline
  annual statement preview (Show/Hide details toggle → PdfPreview). The
  single-PDF endpoint requires `participant_id` + `zev_id` for admins/owners,
  so the preview is participant-only — admins/owners download the whole-ZEV
  ZIP instead. Shared plumbing: `usePdfObjectUrl` hook +
  `fetchAnnualStatementBlob` API wrapper.

Contract embed still needs Content-Disposition: attachment handling
(blob-fetch → URL.createObjectURL) and a surface that renders an inline PDF
per participant without degrading the card grid.
