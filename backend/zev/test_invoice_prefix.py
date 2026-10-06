from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User, UserRole
from testing.helpers import authenticate, create_managed_zev, make_user
from zev.models import Zev


class InvoicePrefixTests(TestCase):
    def setUp(self):
        self.admin = make_user("prefix_admin", UserRole.ADMIN)
        self.client = APIClient()
        authenticate(self.client, self.admin)
        self.zev = create_managed_zev(name="Prefix ZEV", owner=self.admin, invoice_prefix="INV")

    @staticmethod
    def wizard_payload(**overrides):
        return {
            "name": "Wizard ZEV",
            "start_date": "2026-03-01",
            "zev_type": "vzev",
            "billing_interval": "monthly",
            "owner": {"first_name": "Wiz", "last_name": "Ard", "email": "wiz.ard@example.com"},
            "metering_points": [{"meter_id": "METER-WIZ", "meter_type": "consumption"}],
            **overrides,
        }

    def test_wizard_creates_a_zev_with_a_valid_or_blank_prefix(self):
        for prefix, expected in (("ABC-1", "ABC-1"), ("", "INV")):
            with self.subTest(prefix=prefix):
                Zev.objects.filter(name="Wizard ZEV").delete()
                User.objects.filter(email="wiz.ard@example.com").delete()
                response = self.client.post(
                    "/api/v1/zev/zevs/create-with-owner/", self.wizard_payload(invoice_prefix=prefix), format="json",
                )
                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual(Zev.objects.get(name="Wizard ZEV").invoice_prefix, expected)

    def test_invalid_prefixes_are_refused_in_updates(self):
        for prefix in ('INV"', "inv", "MÜ", "../INV", "ABCDEFGHIJK", "A\nB", "", " INV ", "   "):
            with self.subTest(prefix=prefix):
                response = self.client.patch(
                    f"/api/v1/zev/zevs/{self.zev.pk}/", {"invoice_prefix": prefix}, format="json",
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn("invoice_prefix", response.data)
        self.zev.refresh_from_db()
        self.assertEqual(self.zev.invoice_prefix, "INV")

    def test_invalid_prefixes_are_refused_in_the_creation_wizard(self):
        for prefix in ('INV"', "inv", "MÜ", "../INV", "ABCDEFGHIJK", "A\nB"):
            with self.subTest(prefix=prefix):
                response = self.client.post(
                    "/api/v1/zev/zevs/create-with-owner/", self.wizard_payload(invoice_prefix=prefix), format="json",
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn("invoice_prefix", response.data)

    def test_validator_matches_the_whole_value(self):
        from zev.serializers import INVOICE_PREFIX_VALIDATOR
        from django.core.exceptions import ValidationError

        for prefix in ("INV\n", "INV\r\n", "\nINV"):
            with self.subTest(prefix=prefix), self.assertRaises(ValidationError):
                INVOICE_PREFIX_VALIDATOR(prefix)

    def test_valid_prefixes_are_accepted(self):
        for prefix in ("INV", "A1-B2", "0123456789"):
            with self.subTest(prefix=prefix):
                response = self.client.patch(
                    f"/api/v1/zev/zevs/{self.zev.pk}/", {"invoice_prefix": prefix}, format="json",
                )
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data["invoice_prefix"], prefix)

    def test_legacy_prefix_does_not_prevent_an_unrelated_partial_update(self):
        Zev.objects.filter(pk=self.zev.pk).update(invoice_prefix='old"prefix')
        response = self.client.patch(
            f"/api/v1/zev/zevs/{self.zev.pk}/", {"name": "Renamed ZEV"}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.zev.refresh_from_db()
        self.assertEqual(self.zev.invoice_prefix, 'old"prefix')

    def test_legacy_prefix_resubmission_preserves_value(self):
        for legacy in ('old"prefix', "", " inv ", " INV "):
            with self.subTest(legacy=legacy):
                Zev.objects.filter(pk=self.zev.pk).update(invoice_prefix=legacy)
                url = f"/api/v1/zev/zevs/{self.zev.pk}/"
                response = self.client.patch(url, {"name": "Renamed", "invoice_prefix": legacy}, format="json")
                self.assertEqual(response.status_code, 200, response.data)
                self.zev.refresh_from_db()
                self.assertEqual(self.zev.invoice_prefix, legacy)
                response = self.client.patch(url, {"invoice_prefix": "bad one"}, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn("invoice_prefix", response.data)

    def test_migration_reports_invalid_and_blank_prefixes_without_rewriting_them(self):
        import importlib
        from unittest.mock import patch
        from django.apps import apps
        from django.db import connection

        migration = importlib.import_module("zev.migrations.0043_report_invalid_invoice_prefixes")
        for prefix in ('old"prefix', ""):
            with self.subTest(prefix=prefix):
                Zev.objects.filter(pk=self.zev.pk).update(invoice_prefix=prefix)
                with patch("builtins.print") as report:
                    migration.report_invalid_prefixes(apps, connection.schema_editor())
                report.assert_called_once()
                self.assertIn(str(self.zev.pk), report.call_args.args[0])
                self.zev.refresh_from_db()
                self.assertEqual(self.zev.invoice_prefix, prefix)
