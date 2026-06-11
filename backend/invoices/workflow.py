"""
Invoice lifecycle state machine.

Centralizes the allowed status transitions for invoices so the rules are
defined and tested in one place. Both the HTTP views and the Celery email
task delegate to these functions instead of mutating ``Invoice.status``
inline.

State machine::

    draft ──approve──▶ approved ──mark_sent──▶ sent ──mark_paid──▶ paid
      │                   │                      │
      └───────cancel──────┴──────────cancel──────┘        (paid is final)

    cancelled is terminal (but draft/cancelled invoices may be regenerated
    by the engine).
"""

from django.utils import timezone

from .models import Invoice, InvoiceStatus


class InvoiceWorkflowError(Exception):
    """Raised when an invoice status transition is not allowed.

    ``user_message`` carries a safe, predefined string describing the guard
    violation. Views should use this attribute in HTTP responses rather than
    ``str(self)`` to avoid broad exception-message exposure flagged by static
    analysis tools.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.user_message: str = message


def approve_invoice(invoice: Invoice) -> dict:
    """Transition draft → approved. Returns the ``before`` diff dict."""
    if invoice.status != InvoiceStatus.DRAFT:
        raise InvoiceWorkflowError("Only draft invoices can be approved.")
    before = {"status": invoice.status}
    invoice.status = InvoiceStatus.APPROVED
    invoice.save(update_fields=["status", "updated_at"])
    return before


def mark_invoice_sent(invoice: Invoice) -> dict:
    """Transition approved → sent and stamp ``sent_at``. Returns the ``before`` diff dict."""
    if invoice.status != InvoiceStatus.APPROVED:
        raise InvoiceWorkflowError("Only approved invoices can be marked as sent.")
    before = {"status": invoice.status}
    invoice.status = InvoiceStatus.SENT
    invoice.sent_at = timezone.now()
    invoice.save(update_fields=["status", "sent_at", "updated_at"])
    return before


def mark_invoice_paid(invoice: Invoice) -> dict:
    """Transition sent → paid. Returns the ``before`` diff dict."""
    if invoice.status != InvoiceStatus.SENT:
        raise InvoiceWorkflowError("Only sent invoices can be marked as paid.")
    before = {"status": invoice.status}
    invoice.status = InvoiceStatus.PAID
    invoice.save(update_fields=["status", "updated_at"])
    return before


def cancel_invoice(invoice: Invoice) -> dict:
    """Cancel a not-yet-paid invoice. Returns the ``before`` diff dict."""
    if invoice.status == InvoiceStatus.PAID:
        raise InvoiceWorkflowError("Paid invoices cannot be cancelled.")
    if invoice.status == InvoiceStatus.CANCELLED:
        raise InvoiceWorkflowError("Invoice is already cancelled.")
    before = {"status": invoice.status}
    invoice.status = InvoiceStatus.CANCELLED
    invoice.save(update_fields=["status", "updated_at"])
    return before


def record_email_delivery(invoice: Invoice, sent_at) -> str:
    """Record a successful email delivery on the invoice.

    Stamps ``sent_at`` and auto-transitions approved → sent (other statuses
    are left unchanged). Returns the status the invoice had before the call.
    """
    previous_status = invoice.status
    update_fields = ["sent_at"]
    if invoice.status == InvoiceStatus.APPROVED:
        invoice.status = InvoiceStatus.SENT
        update_fields.append("status")
    invoice.sent_at = sent_at
    invoice.save(update_fields=update_fields)
    return previous_status


def can_delete_invoice(invoice: Invoice) -> bool:
    """Non-admins may only delete draft or cancelled invoices."""
    return invoice.status in (InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED)
