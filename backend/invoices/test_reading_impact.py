"""Reading-correction impact: flags without rewriting invoices.

A committed billing-input change records one open ``InvoiceReadingImpact``
per affected invoice (invoice-lifecycle spec §4.6). Imports never touch
snapshots, items, totals, status, PDFs or delivery evidence; drafts resolve
through explicit regeneration and issued invoices through the existing
cancel-and-regenerate workflow.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone as dj_timezone
from rest_framework.test import APIClient

from accounts.models import UserRole
from invoices.engine import generate_invoice
from invoices.models import Invoice, InvoiceReadingImpact, InvoiceStatus
from invoices.readiness import compute_readiness
from invoices.reading_impact import flag_import_impacts
from invoices.workflow import cancel_invoice, mark_invoice_paid, mark_invoice_sent
from metering.models import ImportLog, ImportSource, MeterReading, ReadingDirection
from metering.test_import_sdatch_strict import (
    CONS_ID,
    PROD_ID,
    build_block,
    build_e66,
    quarter_block,
)
from testing.helpers import authenticate as auth, create_managed_zev, make_user
from zev.models import AllocationMode, MeteringPoint, MeteringPointAssignment, MeteringPointType, Participant

INVOICES = "/api/v1/invoices/invoices/"
IMPORT_LOGS = "/api/v1/metering/import-logs/"
SDAT_IMPORT = "/api/v1/metering/import/sdatch/"

JUNE = (date(2025, 6, 1), date(2025, 6, 30))
MAY = (date(2025, 5, 1), date(2025, 5, 31))


def _invoice_number(prefix):
    # uuid, never a counter: parallel workers share no counter state with
    # each other or with the ZEV's own invoice sequence.
    return f"{prefix}-{uuid4().hex[:8]}"


def _change(metering_point, timestamp, direction="in", kind="value"):
    return {
        "metering_point": str(metering_point.pk),
        "meter_id": metering_point.meter_id,
        "timestamp": timestamp,
        "direction": direction,
        "kind": kind,
        "old_energy": "1.0000",
        "new_energy": "2.0000",
    }


def _delivery(**overrides):
    payload = {
        "delivery_id": "DELIVERY-1",
        "creation": "2025-06-05T15:40:05+00:00",
        "status": "5",
        "reason": "E88",
    }
    payload.update(overrides)
    return payload


class ImpactBase(TestCase):
    def setUp(self):
        self.owner = make_user("impact_owner", UserRole.USER)
        self.zev = create_managed_zev(
            name="Impact ZEV", owner=self.owner, zev_type="vzev", invoice_prefix="I"
        )
        self.alice = Participant.objects.create(
            zev=self.zev, first_name="Alice", last_name="Holder",
            email="alice@example.com", valid_from=date(2025, 1, 1),
        )
        self.bob = Participant.objects.create(
            zev=self.zev, first_name="Bob", last_name="Later",
            email="bob@example.com", valid_from=date(2025, 1, 1),
        )
        self.cons = MeteringPoint.objects.create(
            zev=self.zev, meter_id="IMPACT-CONS", meter_type=MeteringPointType.CONSUMPTION,
        )
        self.prod = MeteringPoint.objects.create(
            zev=self.zev, meter_id="IMPACT-PROD", meter_type=MeteringPointType.PRODUCTION,
        )

    def _assign(self, point, participant, valid_from, valid_to=None, mode=AllocationMode.PERSONAL):
        return MeteringPointAssignment.objects.create(
            metering_point=point, participant=participant,
            valid_from=valid_from, valid_to=valid_to, allocation_mode=mode,
        )

    def _invoice(self, participant, period, inv_status=InvoiceStatus.DRAFT):
        return Invoice.objects.create(
            invoice_number=_invoice_number("IMP"), zev=self.zev, participant=participant,
            period_start=period[0], period_end=period[1], status=inv_status,
            total_chf=Decimal("42.00"),
        )

    def _log(self, changes=(), **overrides):
        params = {
            "zev": self.zev, "imported_by": self.owner, "source": ImportSource.SDATCH,
            "filename": "correction.xml", "reading_changes": list(changes),
            "source_delivery": _delivery(),
        }
        params.update(overrides)
        return ImportLog.objects.create(**params)

    def _flag(self, changes, **kwargs):
        log = self._log(changes)
        flagged = flag_import_impacts(
            zev=self.zev, import_log=log, changes=list(changes),
            changes_truncated=False, delivery=_delivery(), **kwargs,
        )
        return log, flagged


class AttributionTests(ImpactBase):
    def test_consumption_change_flags_holder_only(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        self._assign(self.prod, self.bob, date(2025, 1, 1))
        alice_inv = self._invoice(self.alice, JUNE)
        bob_inv = self._invoice(self.bob, JUNE)

        _, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])

        self.assertEqual(flagged, 1)
        self.assertTrue(
            InvoiceReadingImpact.objects.filter(invoice=alice_inv, resolved_at__isnull=True).exists()
        )
        self.assertFalse(
            InvoiceReadingImpact.objects.filter(invoice=bob_inv, resolved_at__isnull=True).exists()
        )

    def test_historical_assignee_flagged_not_current_holder(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1), date(2025, 6, 15))
        self._assign(self.cons, self.bob, date(2025, 6, 16))
        alice_inv = self._invoice(self.alice, JUNE)
        bob_inv = self._invoice(self.bob, JUNE)

        _, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])

        self.assertEqual(flagged, 1)
        self.assertTrue(
            InvoiceReadingImpact.objects.filter(invoice=alice_inv, resolved_at__isnull=True).exists()
        )
        self.assertFalse(
            InvoiceReadingImpact.objects.filter(invoice=bob_inv, resolved_at__isnull=True).exists()
        )

    def test_production_change_flags_whole_community(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        self._assign(self.prod, self.alice, date(2025, 1, 1))
        alice_inv = self._invoice(self.alice, JUNE)
        bob_inv = self._invoice(self.bob, JUNE)

        _, flagged = self._flag([_change(self.prod, "2025-06-10T00:00:00+00:00", direction="out")])

        self.assertEqual(flagged, 2)
        for invoice in (alice_inv, bob_inv):
            self.assertTrue(
                InvoiceReadingImpact.objects.filter(
                    invoice=invoice, resolved_at__isnull=True
                ).exists()
            )

    def test_community_mode_consumption_flags_everyone(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1), mode=AllocationMode.COMMUNITY)
        alice_inv = self._invoice(self.alice, JUNE)
        bob_inv = self._invoice(self.bob, JUNE)

        _, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])

        self.assertEqual(flagged, 2)
        for invoice in (alice_inv, bob_inv):
            self.assertTrue(
                InvoiceReadingImpact.objects.filter(
                    invoice=invoice, resolved_at__isnull=True
                ).exists()
            )

    def test_swiss_business_date_routes_the_period(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        may_inv = self._invoice(self.alice, MAY)
        june_inv = self._invoice(self.alice, JUNE)

        # 2025-06-02T22:00Z is 2025-06-03 00:00 in Zurich (CEST): a June reading.
        _, flagged = self._flag([_change(self.cons, "2025-06-02T22:00:00+00:00")])

        self.assertEqual(flagged, 1)
        self.assertTrue(
            InvoiceReadingImpact.objects.filter(invoice=june_inv, resolved_at__isnull=True).exists()
        )
        self.assertFalse(
            InvoiceReadingImpact.objects.filter(invoice=may_inv, resolved_at__isnull=True).exists()
        )

    def test_unrelated_period_and_zev_stay_unflagged(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        may_inv = self._invoice(self.alice, MAY)
        other_owner = make_user("impact_other", UserRole.USER)
        other_zev = create_managed_zev(
            name="Other ZEV", owner=other_owner, zev_type="vzev", invoice_prefix="O"
        )
        other = Participant.objects.create(
            zev=other_zev, first_name="Zed", last_name="Other",
            email="zed@example.com", valid_from=date(2025, 1, 1),
        )
        other_inv = Invoice.objects.create(
            invoice_number=_invoice_number("O"), zev=other_zev, participant=other,
            period_start=JUNE[0], period_end=JUNE[1], total_chf=Decimal("1.00"),
        )

        _, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])

        self.assertEqual(flagged, 0)
        self.assertFalse(
            InvoiceReadingImpact.objects.filter(invoice=may_inv, resolved_at__isnull=True).exists()
        )
        self.assertFalse(
            InvoiceReadingImpact.objects.filter(invoice=other_inv, resolved_at__isnull=True).exists()
        )

    def test_metadata_only_and_empty_changes_flag_nothing(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        invoice = self._invoice(self.alice, JUNE)

        _, flagged_meta = self._flag(
            [_change(self.cons, "2025-06-10T00:00:00+00:00", kind="metadata")]
        )
        _, flagged_empty = self._flag([])

        self.assertEqual(flagged_meta, 0)
        self.assertEqual(flagged_empty, 0)
        self.assertFalse(
            InvoiceReadingImpact.objects.filter(invoice=invoice).exists()
        )

    def test_cancelled_invoices_are_not_flagged(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        cancelled = self._invoice(self.alice, JUNE, inv_status=InvoiceStatus.CANCELLED)

        _, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])

        self.assertEqual(flagged, 0)
        self.assertFalse(InvoiceReadingImpact.objects.filter(invoice=cancelled).exists())

    def test_flagging_is_idempotent_per_import(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        invoice = self._invoice(self.alice, JUNE)
        changes = [_change(self.cons, "2025-06-10T00:00:00+00:00")]
        log = self._log(changes)

        first = flag_import_impacts(
            zev=self.zev, import_log=log, changes=changes,
            changes_truncated=False, delivery=_delivery(),
        )
        second = flag_import_impacts(
            zev=self.zev, import_log=log, changes=changes,
            changes_truncated=False, delivery=_delivery(),
        )

        self.assertEqual((first, second), (1, 0))
        self.assertEqual(
            InvoiceReadingImpact.objects.filter(invoice=invoice, resolved_at__isnull=True).count(), 1
        )


class SdatImportBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_user("sdat_impact_owner", UserRole.USER)
        self.zev = create_managed_zev(
            name="SDAT Impact ZEV", owner=self.owner, zev_type="vzev", invoice_prefix="S"
        )
        # After the grant: promoting the account retires tokens minted before it.
        auth(self.client, self.owner)
        self.participant = Participant.objects.create(
            zev=self.zev, first_name="Sam", last_name="Meter",
            email="sam@example.com", valid_from=date(2025, 1, 1),
        )
        self.cons_mp = MeteringPoint.objects.create(
            zev=self.zev, meter_id=CONS_ID, meter_type=MeteringPointType.CONSUMPTION,
        )
        self.prod_mp = MeteringPoint.objects.create(
            zev=self.zev, meter_id=PROD_ID, meter_type=MeteringPointType.PRODUCTION,
        )
        MeteringPointAssignment.objects.create(
            metering_point=self.cons_mp, participant=self.participant,
            valid_from=date(2025, 1, 1),
        )
        MeteringPointAssignment.objects.create(
            metering_point=self.prod_mp, participant=self.participant,
            valid_from=date(2025, 1, 1),
        )

    def _upload(self, content, name="delivery.xml"):
        upload = SimpleUploadedFile(name, content, content_type="application/xml")
        return self.client.post(
            SDAT_IMPORT, {"file": upload, "zev_id": str(self.zev.id)}, format="multipart"
        )

    def _original(self, **kwargs):
        return self._upload(
            build_e66(
                [quarter_block(CONS_ID, "2025-06-02T22:00:00Z", 4, doc="ORIG-BLOCK")],
                creation="2025-06-05T10:00:00Z",
                delivery_id="ORIG-DELIVERY",
                **kwargs,
            )
        )

    def _correction(self, **kwargs):
        obs = "".join(
            f"<rsm:Observation><rsm:Position><rsm:Sequence>{seq}</rsm:Sequence></rsm:Position>"
            f"<rsm:Volume>{500 + seq}</rsm:Volume></rsm:Observation>"
            for seq in range(1, 5)
        )
        return self._upload(
            build_e66(
                [
                    build_block(
                        CONS_ID, obs, doc="FIX-BLOCK",
                        start="2025-06-02T22:00:00Z", end="2025-06-02T23:00:00Z",
                    )
                ],
                status="5",
                creation="2025-06-06T10:00:00Z",
                delivery_id="FIX-DELIVERY",
                **kwargs,
            )
        )

    def _invoice(self, inv_status=InvoiceStatus.DRAFT):
        return Invoice.objects.create(
            invoice_number=_invoice_number("S"), zev=self.zev, participant=self.participant,
            period_start=JUNE[0], period_end=JUNE[1], status=inv_status,
            total_chf=Decimal("42.00"),
        )


class CorrectionImportTests(SdatImportBase):
    def test_correction_flags_the_overlapping_invoice(self):
        invoice = self._invoice()
        self.assertEqual(self._original().data["result_status"], "accepted")

        resp = self._correction()

        self.assertEqual(resp.data["result_status"], "accepted")
        self.assertGreater(resp.data["rows_overwritten"], 0)
        impact = InvoiceReadingImpact.objects.get(
            invoice=invoice,
            import_log_id=resp.data["id"],
            resolved_at__isnull=True,
        )
        self.assertEqual(impact.evidence["delivery_id"], "FIX-DELIVERY")
        self.assertEqual(impact.evidence["source"], "sdat-import")
        self.assertIn("value", impact.evidence["kinds"])
        # The original delivery's new data flagged the invoice too.
        self.assertEqual(
            InvoiceReadingImpact.objects.filter(
                invoice=invoice, resolved_at__isnull=True
            ).count(),
            2,
        )

    def test_import_leaves_invoice_documents_untouched(self):
        invoice = self._invoice(inv_status=InvoiceStatus.SENT)
        invoice.sent_at = dj_timezone.now()
        invoice.save(update_fields=["sent_at"])
        from invoices.models import EmailLog, InvoiceItem

        InvoiceItem.objects.create(
            invoice=invoice, item_type="local_energy", description="Solar",
            quantity_kwh=Decimal("5"), total_chf=Decimal("1.00"),
        )
        email = EmailLog.objects.create(
            invoice=invoice, recipient="sam@example.com", subject="s", status="sent"
        )
        before = {
            "status": invoice.status,
            "totals": [invoice.total_chf, invoice.subtotal_chf],
            "items": list(
                invoice.items.order_by("id").values_list("description", "quantity_kwh", "total_chf")
            ),
            "pdf_status": invoice.pdf_status,
            "sent_at": invoice.sent_at,
            "emails": list(
                EmailLog.objects.filter(invoice=invoice).values_list("id", "status")
            ),
        }
        self.assertEqual(self._original().data["result_status"], "accepted")

        resp = self._correction()

        self.assertEqual(resp.data["result_status"], "accepted")
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, before["status"])
        self.assertEqual([invoice.total_chf, invoice.subtotal_chf], before["totals"])
        self.assertEqual(
            list(invoice.items.order_by("id").values_list("description", "quantity_kwh", "total_chf")),
            before["items"],
        )
        self.assertEqual(invoice.pdf_status, before["pdf_status"])
        self.assertEqual(invoice.sent_at, before["sent_at"])
        self.assertEqual(
            list(EmailLog.objects.filter(invoice=invoice).values_list("id", "status")),
            before["emails"],
        )
        self.assertEqual(EmailLog.objects.get(pk=email.pk).status, "sent")
        self.assertTrue(
            InvoiceReadingImpact.objects.filter(invoice=invoice, resolved_at__isnull=True).exists()
        )

    def test_held_duplicate_stale_and_rejected_files_flag_nothing(self):
        invoice = self._invoice()
        self.assertEqual(self._original().data["result_status"], "accepted")

        held = self._upload(
            build_e66(
                [quarter_block(CONS_ID, "2025-06-03T22:00:00Z", 4, doc="INFO-BLOCK")],
                reason_xml="<rsm:VSENationalCode>C38</rsm:VSENationalCode>",
                creation="2025-06-06T10:00:00Z",
                delivery_id="INFO-DELIVERY",
            )
        )
        self.assertEqual(held.data["result_status"], "held")

        duplicate = self._original()
        self.assertEqual(duplicate.data["result_status"], "unchanged")

        stale = self._upload(
            build_e66(
                [quarter_block(CONS_ID, "2025-06-02T22:00:00Z", 4, doc="STALE-BLOCK")],
                status="5",
                creation="2025-06-04T10:00:00Z",
                delivery_id="STALE-DELIVERY",
            )
        )
        self.assertEqual(stale.data["result_status"], "unchanged")

        conflict = self._upload(
            build_e66(
                [
                    build_block(
                        CONS_ID,
                        "".join(
                            f"<rsm:Observation><rsm:Position><rsm:Sequence>{seq}</rsm:Sequence></rsm:Position>"
                            f"<rsm:Volume>{900 + seq}</rsm:Volume></rsm:Observation>"
                            for seq in range(1, 5)
                        ),
                        doc="CLASH-BLOCK",
                        start="2025-06-02T22:00:00Z",
                        end="2025-06-02T23:00:00Z",
                    )
                ],
                status="5",
                creation="2025-06-05T10:00:00Z",
                delivery_id="CLASH-DELIVERY",
            )
        )
        self.assertEqual(conflict.data["result_status"], "rejected")

        for resp in (held, duplicate, stale, conflict):
            self.assertEqual(resp.data["reading_changes"], [])
        # Only the original delivery's new data flagged the invoice; replays,
        # stale skips, held-only files and rejections add nothing.
        impacts = InvoiceReadingImpact.objects.filter(invoice=invoice)
        self.assertEqual(impacts.count(), 1)
        self.assertEqual(impacts.get().evidence["delivery_id"], "ORIG-DELIVERY")


class DraftRegenerationTests(ImpactBase):
    def setUp(self):
        super().setUp()
        from tariffs.models import (
            BillingMode, EnergyType, PeriodType, Tariff, TariffCategory, TariffPeriod,
        )

        for energy_type, price in [
            (EnergyType.LOCAL, Decimal("0.15")),
            (EnergyType.GRID, Decimal("0.25")),
            (EnergyType.FEED_IN, Decimal("0.08")),
        ]:
            tariff = Tariff.objects.create(
                zev=self.zev, name=f"{energy_type} tariff",
                category=TariffCategory.ENERGY, billing_mode=BillingMode.ENERGY,
                energy_type=energy_type, valid_from=date(2025, 1, 1),
            )
            TariffPeriod.objects.create(
                tariff=tariff, period_type=PeriodType.FLAT, price_chf_per_kwh=price,
            )
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        MeterReading.objects.create(
            metering_point=self.cons,
            timestamp=datetime(2025, 6, 10, 0, 0, tzinfo=timezone.utc),
            energy_kwh=Decimal("10.0"), direction=ReadingDirection.IN,
        )

    def test_successful_regeneration_resolves_incorporated_impacts(self):
        draft = generate_invoice(self.alice, JUNE[0], JUNE[1])
        log, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])
        self.assertEqual(flagged, 1)

        regenerated = generate_invoice(self.alice, JUNE[0], JUNE[1])

        self.assertNotEqual(regenerated.pk, draft.pk)
        self.assertFalse(InvoiceReadingImpact.objects.filter(invoice_id=draft.pk).exists())
        self.assertFalse(
            InvoiceReadingImpact.objects.filter(invoice=regenerated, resolved_at__isnull=True).exists()
        )

    def test_later_correction_carries_to_the_new_invoice(self):
        draft = generate_invoice(self.alice, JUNE[0], JUNE[1])
        log, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])
        self.assertEqual(flagged, 1)
        InvoiceReadingImpact.objects.filter(invoice=draft).update(
            created_at=dj_timezone.now() + timedelta(hours=1)
        )

        regenerated = generate_invoice(self.alice, JUNE[0], JUNE[1])

        carried = InvoiceReadingImpact.objects.get(
            invoice=regenerated, resolved_at__isnull=True
        )
        self.assertEqual(carried.import_log_id, log.id)

    def test_failed_regeneration_keeps_the_flag(self):
        draft = generate_invoice(self.alice, JUNE[0], JUNE[1])
        _, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])
        self.assertEqual(flagged, 1)
        blocking = self._invoice(self.alice, (date(2025, 6, 15), date(2025, 7, 15)),
                                 inv_status=InvoiceStatus.APPROVED)

        with self.assertRaises(ValueError):
            generate_invoice(self.alice, JUNE[0], JUNE[1])

        blocking.delete()
        self.assertTrue(
            InvoiceReadingImpact.objects.filter(invoice=draft, resolved_at__isnull=True).exists()
        )


class FinalInvoiceResolutionTests(ImpactBase):
    def test_cancel_resolves_and_paid_keeps_the_flag(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        invoice = self._invoice(self.alice, JUNE, inv_status=InvoiceStatus.APPROVED)
        _, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])
        self.assertEqual(flagged, 1)

        mark_invoice_sent(invoice)
        mark_invoice_paid(invoice)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, InvoiceStatus.PAID)
        self.assertTrue(
            InvoiceReadingImpact.objects.filter(invoice=invoice, resolved_at__isnull=True).exists()
        )

        with self.assertRaises(Exception):
            cancel_invoice(invoice)
        self.assertTrue(
            InvoiceReadingImpact.objects.filter(invoice=invoice, resolved_at__isnull=True).exists()
        )

    def test_cancelled_issued_invoice_resolves_its_impacts(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        invoice = self._invoice(self.alice, JUNE, inv_status=InvoiceStatus.SENT)
        _, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])
        self.assertEqual(flagged, 1)

        cancel_invoice(invoice)

        impact = InvoiceReadingImpact.objects.get(invoice=invoice)
        self.assertEqual(impact.resolution, "cancelled")
        self.assertIsNotNone(impact.resolved_at)
        self.assertFalse(
            InvoiceReadingImpact.objects.filter(invoice=invoice, resolved_at__isnull=True).exists()
        )


class VisibilityTests(ImpactBase):
    def setUp(self):
        super().setUp()
        self.client = APIClient()
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        self.invoice = self._invoice(self.alice, JUNE, inv_status=InvoiceStatus.SENT)
        self.invoice.sent_at = dj_timezone.now()
        self.invoice.save(update_fields=["sent_at"])
        self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])

    def test_manager_sees_flag_and_evidence(self):
        auth(self.client, self.owner)
        response = self.client.get(f"{INVOICES}{self.invoice.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.data["needs_data_review"])
        self.assertEqual(response.data["open_data_impact_count"], 1)
        self.assertEqual(len(response.data["data_impacts"]), 1)
        self.assertEqual(
            response.data["data_impacts"][0]["evidence"]["delivery_id"], "DELIVERY-1"
        )

        listed = self.client.get(INVOICES)
        row = next(item for item in listed.data["results"] if item["id"] == str(self.invoice.id))
        self.assertTrue(row["needs_data_review"])
        self.assertEqual(row["open_data_impact_count"], 1)
        self.assertNotIn("data_impacts", row)

    def test_participant_sees_flag_on_their_sent_invoice(self):
        tenant = make_user("impact_tenant", UserRole.USER)
        self.alice.user = tenant
        self.alice.save(update_fields=["user"])
        auth(self.client, tenant)

        response = self.client.get(f"{INVOICES}{self.invoice.id}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.data["needs_data_review"])
        self.assertEqual(len(response.data["data_impacts"]), 1)

    def test_other_zev_manager_sees_nothing(self):
        other_owner = make_user("impact_stranger", UserRole.USER)
        create_managed_zev(name="Stranger ZEV", owner=other_owner, zev_type="vzev")
        auth(self.client, other_owner)

        listed = self.client.get(INVOICES)
        self.assertEqual(listed.status_code, 200)
        self.assertNotIn(str(self.invoice.id), {item["id"] for item in listed.data["results"]})
        detail = self.client.get(f"{INVOICES}{self.invoice.id}/")
        self.assertEqual(detail.status_code, 404)


class ReadinessImpactTests(ImpactBase):
    def test_data_corrections_step_warns_with_impacted_invoices(self):
        self._assign(self.cons, self.alice, date(2025, 1, 1))
        invoice = self._invoice(self.alice, JUNE)
        self.assertEqual(
            next(
                step for step in compute_readiness(self.zev, JUNE[0], JUNE[1])["steps"]
                if step["key"] == "data_corrections"
            )["status"],
            "ok",
        )

        self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])

        step = next(
            step for step in compute_readiness(self.zev, JUNE[0], JUNE[1])["steps"]
            if step["key"] == "data_corrections"
        )
        self.assertEqual(step["status"], "warn")
        self.assertEqual(step["count"], 1)
        self.assertEqual(step["detail_data"]["corrections"][0]["invoice_id"], str(invoice.id))
        self.assertEqual(
            step["detail_data"]["corrections"][0]["participant_name"], "Alice Holder"
        )


class BackupRoundTripTests(ImpactBase):
    def test_impact_flags_survive_backup_restore(self):
        import io

        from backups import restore_zev
        from backups.test_archive import build

        self._assign(self.cons, self.alice, date(2025, 1, 1))
        invoice = self._invoice(self.alice, JUNE)
        log, flagged = self._flag([_change(self.cons, "2025-06-10T00:00:00+00:00")])
        self.assertEqual(flagged, 1)
        raw, _manifest = build(scope="zev", zev=self.zev)

        InvoiceReadingImpact.objects.all().delete()
        restore_zev.restore_zev(io.BytesIO(raw), str(self.zev.id))

        impact = InvoiceReadingImpact.objects.get(invoice=invoice, resolved_at__isnull=True)
        self.assertEqual(impact.import_log_id, log.id)
        self.assertEqual(impact.evidence["delivery_id"], "DELIVERY-1")


class DeletionImpactTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_user("deletion_impact_owner", UserRole.USER)
        self.zev = create_managed_zev(
            name="Deletion Impact ZEV", owner=self.owner, zev_type="vzev", invoice_prefix="D"
        )
        # After the grant: promoting the account retires tokens minted before it.
        auth(self.client, self.owner)
        self.participant = Participant.objects.create(
            zev=self.zev, first_name="Del", last_name="Case",
            email="del@example.com", valid_from=date(2025, 1, 1),
        )
        self.cons = MeteringPoint.objects.create(
            zev=self.zev, meter_id="DEL-CONS", meter_type=MeteringPointType.CONSUMPTION,
        )
        MeteringPointAssignment.objects.create(
            metering_point=self.cons, participant=self.participant,
            valid_from=date(2025, 1, 1),
        )

    def _additive_log_with_reading(self):
        import uuid

        batch = uuid.uuid4()
        log = ImportLog.objects.create(
            zev=self.zev, imported_by=self.owner, source=ImportSource.CSV,
            filename="additive.csv", batch_id=batch,
        )
        MeterReading.objects.create(
            metering_point=self.cons,
            timestamp=datetime(2025, 6, 10, 0, 0, tzinfo=timezone.utc),
            energy_kwh=Decimal("7.0"), direction=ReadingDirection.IN,
            import_source=ImportSource.CSV, import_batch=batch,
        )
        return log

    def test_billable_deletion_flags_the_invoice(self):
        invoice = Invoice.objects.create(
            invoice_number=_invoice_number("D"), zev=self.zev, participant=self.participant,
            period_start=JUNE[0], period_end=JUNE[1], total_chf=Decimal("9.00"),
        )
        log = self._additive_log_with_reading()

        resp = self.client.delete(f"{IMPORT_LOGS}{log.id}/")

        self.assertEqual(resp.status_code, 200, resp.content)
        impact = InvoiceReadingImpact.objects.get(invoice=invoice, resolved_at__isnull=True)
        self.assertEqual(impact.evidence["source"], "import-deletion")
        self.assertIsNone(impact.import_log)

    def test_deletion_flag_survives_log_removal(self):
        invoice = Invoice.objects.create(
            invoice_number=_invoice_number("D"), zev=self.zev, participant=self.participant,
            period_start=JUNE[0], period_end=JUNE[1], total_chf=Decimal("9.00"),
        )
        log = self._additive_log_with_reading()
        self.client.delete(f"{IMPORT_LOGS}{log.id}/")

        impact = InvoiceReadingImpact.objects.get(invoice=invoice)
        self.assertEqual(impact.evidence["day_from"], "2025-06-10")
        self.assertEqual(impact.evidence["deleted_readings"], 1)
