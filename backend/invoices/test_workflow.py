"""Invoice lifecycle workflow and regeneration guard tests."""

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import UserRole
from invoices.models import InvoiceStatus
from invoices.test_helpers import make_invoice, make_participant, make_user, make_zev
from testing.helpers import authenticate as auth


class InvoiceWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_user("wf_owner", UserRole.ZEV_OWNER)
        self.zev = make_zev(self.owner, "WF ZEV")
        self.participant = make_participant(self.zev)
        auth(self.client, self.owner)

    def _action(self, invoice, action_url):
        return self.client.post(f"/api/v1/invoices/invoices/{invoice.pk}/{action_url}/")

    def test_approve_draft(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.DRAFT)
        resp = self._action(inv, "approve")
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.status, InvoiceStatus.APPROVED)

    def test_approve_already_approved_fails(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.APPROVED)
        resp = self._action(inv, "approve")
        self.assertEqual(resp.status_code, 400)

    def test_mark_sent_from_approved(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.APPROVED)
        resp = self._action(inv, "mark-sent")
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.status, InvoiceStatus.SENT)
        self.assertIsNotNone(inv.sent_at)

    def test_mark_sent_from_draft_fails(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.DRAFT)
        resp = self._action(inv, "mark-sent")
        self.assertEqual(resp.status_code, 400)

    def test_mark_paid_from_sent(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.SENT)
        resp = self._action(inv, "mark-paid")
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.status, InvoiceStatus.PAID)

    def test_mark_paid_from_draft_fails(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.DRAFT)
        resp = self._action(inv, "mark-paid")
        self.assertEqual(resp.status_code, 400)

    def test_cancel_draft(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.DRAFT)
        resp = self._action(inv, "cancel")
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.status, InvoiceStatus.CANCELLED)

    def test_cancel_approved(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.APPROVED)
        resp = self._action(inv, "cancel")
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.status, InvoiceStatus.CANCELLED)

    def test_cancel_sent(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.SENT)
        resp = self._action(inv, "cancel")
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.status, InvoiceStatus.CANCELLED)

    def test_cancel_paid_fails(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.PAID)
        resp = self._action(inv, "cancel")
        self.assertEqual(resp.status_code, 400)

    def test_cancel_already_cancelled_fails(self):
        inv = make_invoice(self.zev, self.participant, InvoiceStatus.CANCELLED)
        resp = self._action(inv, "cancel")
        self.assertEqual(resp.status_code, 400)


class InvoiceEngineGuardTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_user("guard_owner", UserRole.ZEV_OWNER)
        self.zev = make_zev(self.owner, "GuardZEV")
        self.participant = make_participant(self.zev)
        auth(self.client, self.owner)

    def _generate(self, participant_id):
        return self.client.post("/api/v1/invoices/invoices/generate/", {
            "participant_id": str(participant_id),
            "period_start": "2026-01-01",
            "period_end": "2026-01-31",
        })

    def test_regenerate_approved_invoice_returns_409(self):
        make_invoice(self.zev, self.participant, InvoiceStatus.APPROVED)
        resp = self._generate(self.participant.pk)
        self.assertEqual(resp.status_code, 409)

    def test_regenerate_paid_invoice_returns_409(self):
        make_invoice(self.zev, self.participant, InvoiceStatus.PAID)
        resp = self._generate(self.participant.pk)
        self.assertEqual(resp.status_code, 409)

    def test_regenerate_draft_invoice_succeeds(self):
        make_invoice(self.zev, self.participant, InvoiceStatus.DRAFT)
        resp = self._generate(self.participant.pk)
        # Engine replaces draft; no 409 expected (may be 201 or other non-conflict)
        self.assertNotEqual(resp.status_code, 409)

    def test_regenerate_cancelled_invoice_succeeds(self):
        make_invoice(self.zev, self.participant, InvoiceStatus.CANCELLED)
        resp = self._generate(self.participant.pk)
        self.assertNotEqual(resp.status_code, 409)
