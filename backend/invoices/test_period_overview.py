"""Invoice period overview readiness tests."""

from datetime import date, datetime, timezone
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import UserRole
from invoices.models import InvoiceStatus
from invoices.test_helpers import make_invoice, make_participant, make_user, make_zev
from metering.models import MeterReading, ReadingDirection, ReadingResolution
from testing.helpers import authenticate as auth
from zev.models import MeteringPoint, MeteringPointAssignment, MeteringPointType


class InvoicePeriodOverviewTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_user("overview_owner", UserRole.ZEV_OWNER)
        self.other_owner = make_user("overview_other_owner", UserRole.ZEV_OWNER)
        self.zev = make_zev(self.owner, "Overview ZEV")

        self.p_with_data = make_participant(self.zev, first="With", last="Data")
        self.p_missing_data = make_participant(self.zev, first="Missing", last="Data")

        self.mp_with_data = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH-OVERVIEW-1",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        self.mp_missing_data = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH-OVERVIEW-2",
            meter_type=MeteringPointType.CONSUMPTION,
        )

        # Assignments define whose meter requires readings on which days.
        MeteringPointAssignment.objects.create(
            metering_point=self.mp_with_data,
            participant=self.p_with_data,
            valid_from=date(2026, 1, 1),
        )
        MeteringPointAssignment.objects.create(
            metering_point=self.mp_missing_data,
            participant=self.p_missing_data,
            valid_from=date(2026, 1, 1),
        )

        for day in range(1, 32):
            MeterReading.objects.create(
                metering_point=self.mp_with_data,
                timestamp=datetime(2026, 1, day, 0, 0, tzinfo=timezone.utc),
                energy_kwh=Decimal("3.0000"),
                direction=ReadingDirection.IN,
                resolution=ReadingResolution.FIFTEEN_MIN,
            )

        self.invoice = make_invoice(self.zev, self.p_with_data, InvoiceStatus.DRAFT)

    def test_owner_gets_participant_rows_with_invoice_and_metering_readiness(self):
        auth(self.client, self.owner)

        resp = self.client.get(
            "/api/v1/invoices/invoices/period-overview/",
            {
                "zev_id": str(self.zev.id),
                "period_start": "2026-01-01",
                "period_end": "2026-01-31",
            },
        )

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["billing_interval"], self.zev.billing_interval)
        self.assertEqual(len(resp.data["rows"]), 2)

        rows_by_participant = {row["participant_name"]: row for row in resp.data["rows"]}

        with_data_row = rows_by_participant[self.p_with_data.full_name]
        self.assertTrue(with_data_row["metering_data_complete"])
        self.assertIsNotNone(with_data_row["invoice"])
        self.assertEqual(with_data_row["invoice"]["id"], str(self.invoice.id))

        missing_data_row = rows_by_participant[self.p_missing_data.full_name]
        self.assertFalse(missing_data_row["metering_data_complete"])
        self.assertEqual(missing_data_row["missing_meter_ids"], ["CH-OVERVIEW-2"])
        self.assertEqual(missing_data_row["missing_meter_details"], [{"meter_id": "CH-OVERVIEW-2", "missing_days": 31}])
        self.assertIsNone(missing_data_row["invoice"])

    def test_owner_cannot_view_other_owners_zev_overview(self):
        auth(self.client, self.other_owner)

        resp = self.client.get(
            "/api/v1/invoices/invoices/period-overview/",
            {
                "zev_id": str(self.zev.id),
                "period_start": "2026-01-01",
                "period_end": "2026-01-31",
            },
        )

        self.assertEqual(resp.status_code, 403)

    def test_partial_daily_coverage_marks_metering_incomplete(self):
        MeterReading.objects.filter(
            metering_point=self.mp_with_data,
            timestamp__date=date(2026, 1, 31),
        ).delete()

        auth(self.client, self.owner)

        resp = self.client.get(
            "/api/v1/invoices/invoices/period-overview/",
            {
                "zev_id": str(self.zev.id),
                "period_start": "2026-01-01",
                "period_end": "2026-01-31",
            },
        )

        self.assertEqual(resp.status_code, 200)
        rows_by_participant = {row["participant_name"]: row for row in resp.data["rows"]}

        with_data_row = rows_by_participant[self.p_with_data.full_name]
        self.assertFalse(with_data_row["metering_data_complete"])
        self.assertEqual(with_data_row["missing_meter_ids"], ["CH-OVERVIEW-1"])
        self.assertEqual(with_data_row["missing_meter_details"], [{"meter_id": "CH-OVERVIEW-1", "missing_days": 1}])

    def test_partial_period_assignment_only_requires_data_for_assigned_days(self):
        """If an assignment covers only part of the period, only those days require readings."""
        # Remove the full-period assignment for p_with_data and replace with a mid-month one.
        MeteringPointAssignment.objects.filter(metering_point=self.mp_with_data).delete()
        MeteringPointAssignment.objects.create(
            metering_point=self.mp_with_data,
            participant=self.p_with_data,
            valid_from=date(2026, 1, 11),
            valid_to=date(2026, 1, 20),
        )
        # Jan 1–31 readings exist; only Jan 11–20 (10 days) should be checked.
        # All 10 assigned days have readings → complete.
        auth(self.client, self.owner)
        resp = self.client.get(
            "/api/v1/invoices/invoices/period-overview/",
            {"zev_id": str(self.zev.id), "period_start": "2026-01-01", "period_end": "2026-01-31"},
        )
        self.assertEqual(resp.status_code, 200)
        rows_by_participant = {row["participant_name"]: row for row in resp.data["rows"]}
        with_data_row = rows_by_participant[self.p_with_data.full_name]
        self.assertTrue(with_data_row["metering_data_complete"])

    def test_no_assignment_means_participant_excluded_from_overview(self):
        """A participant with no assignment in the period is excluded from the overview entirely."""
        # Remove the assignment for p_with_data so they have no assignment this period.
        MeteringPointAssignment.objects.filter(metering_point=self.mp_with_data).delete()

        auth(self.client, self.owner)
        resp = self.client.get(
            "/api/v1/invoices/invoices/period-overview/",
            {"zev_id": str(self.zev.id), "period_start": "2026-01-01", "period_end": "2026-01-31"},
        )
        self.assertEqual(resp.status_code, 200)
        participant_names = [row["participant_name"] for row in resp.data["rows"]]
        # p_with_data has no assignment → excluded
        self.assertNotIn(self.p_with_data.full_name, participant_names)
        # p_missing_data still has an assignment → included
        self.assertIn(self.p_missing_data.full_name, participant_names)
