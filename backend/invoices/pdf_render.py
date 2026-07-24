"""Shared WeasyPrint rendering helper.

All document PDFs (invoices, annual statements, financial summaries, contracts)
are rendered through :func:`render_pdf` so they share a single output format.

We emit **PDF/A-3b**: a long-term-archival format (relevant for Swiss GeBüV
retention) whose ``3`` level also permits embedding structured attachments,
keeping the door open for e-invoicing payloads (eBill / Factur-X style) next to
the existing QR-Rechnung. WeasyPrint adds the required XMP identification,
sRGB OutputIntent (with embedded ICC profile) and font subsets automatically.
"""
from weasyprint import HTML

# PDF/A-3b — see module docstring for the rationale behind this variant.
PDF_VARIANT = "pdf/a-3b"


def render_pdf(html_string: str, *, base_url: str = ".") -> bytes:
    """Render an HTML string to PDF/A bytes."""
    return HTML(string=html_string, base_url=base_url).write_pdf(pdf_variant=PDF_VARIANT)
