# Contract & Annual Statement PDF Embed

Deferred from SPEC-2026-08 §6.2.

PdfPreview is only on InvoiceDetailPage & AdminPdfTemplatesPage. Embed on:
- Contract detail: blob-fetch GET /api/v1/zev/participants/{pk}/contract-pdf/
- Annual statement download page

Both need Content-Disposition: attachment handling (blob-fetch → URL.createObjectURL).
