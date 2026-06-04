from datetime import date, datetime, timezone
from decimal import Decimal

from django.test import TestCase

from accounts.models import UserRole, VatRate
from invoices.engine import generate_invoice
from invoices.models import InvoiceItem
from invoices.test_helpers import make_participant, make_user, make_zev
from metering.models import MeterReading, ReadingDirection, ReadingResolution
from tariffs.models import BillingMode, EnergyType, Tariff, TariffCategory, TariffPeriod
from zev.models import MeteringPoint, MeteringPointAssignment, MeteringPointType


class InvoiceMathEdgeCaseTests(TestCase):
    def setUp(self):
        self.owner = make_user("math_owner", UserRole.ZEV_OWNER)
        self.zev = make_zev(self.owner, "Math ZEV")
        self.participant = make_participant(self.zev, first="Math", last="Case")

        self.consumption_mp = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH-MATH-CONS-1",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        MeteringPointAssignment.objects.create(
            metering_point=self.consumption_mp,
            participant=self.participant,
            valid_from=date(2026, 1, 1),
        )

    def test_monthly_fee_counts_intersecting_month_boundaries(self):
        tariff = Tariff.objects.create(
            zev=self.zev,
            name="Ops Monthly",
            category=TariffCategory.GRID_FEES,
            billing_mode=BillingMode.MONTHLY_FEE,
            fixed_price_chf=Decimal("5.00"),
            valid_from=date(2026, 1, 1),
        )

        invoice = generate_invoice(self.participant, date(2026, 1, 15), date(2026, 2, 14))
        item = invoice.items.get(description__startswith=tariff.name)

        self.assertEqual(item.quantity_kwh, Decimal("2.0000"))
        self.assertEqual(item.total_chf, Decimal("10.00"))
        self.assertEqual(invoice.subtotal_chf, Decimal("10.00"))
        self.assertEqual(invoice.total_chf, Decimal("10.00"))

    def test_energy_tariff_applies_only_within_validity_window(self):
        tariff = Tariff.objects.create(
            zev=self.zev,
            name="Grid Window",
            category=TariffCategory.ENERGY,
            billing_mode=BillingMode.ENERGY,
            energy_type=EnergyType.GRID,
            valid_from=date(2026, 1, 15),
            valid_to=date(2026, 1, 31),
        )
        TariffPeriod.objects.create(
            tariff=tariff,
            period_type="flat",
            price_chf_per_kwh=Decimal("0.20000"),
        )

        MeterReading.objects.create(
            metering_point=self.consumption_mp,
            timestamp=datetime(2026, 1, 10, 0, 0, tzinfo=timezone.utc),
            energy_kwh=Decimal("5.0000"),
            direction=ReadingDirection.IN,
            resolution=ReadingResolution.FIFTEEN_MIN,
        )
        MeterReading.objects.create(
            metering_point=self.consumption_mp,
            timestamp=datetime(2026, 1, 20, 0, 0, tzinfo=timezone.utc),
            energy_kwh=Decimal("5.0000"),
            direction=ReadingDirection.IN,
            resolution=ReadingResolution.FIFTEEN_MIN,
        )

        invoice = generate_invoice(self.participant, date(2026, 1, 1), date(2026, 1, 31))
        item = invoice.items.get(description=tariff.name)

        self.assertEqual(item.quantity_kwh, Decimal("5.0000"))
        self.assertEqual(item.total_chf, Decimal("1.00"))
        self.assertEqual(invoice.total_grid_kwh, Decimal("10.0000"))
        self.assertEqual(invoice.subtotal_chf, Decimal("1.00"))

    def test_zero_and_negative_fixed_fees_are_handled_consistently(self):
        zero_fee = Tariff.objects.create(
            zev=self.zev,
            name="Zero Platform Fee",
            category=TariffCategory.LEVIES,
            billing_mode=BillingMode.MONTHLY_FEE,
            fixed_price_chf=Decimal("0.00"),
            valid_from=date(2026, 1, 1),
        )
        yearly_credit = Tariff.objects.create(
            zev=self.zev,
            name="Goodwill Credit",
            category=TariffCategory.LEVIES,
            billing_mode=BillingMode.YEARLY_FEE,
            fixed_price_chf=Decimal("-120.00"),
            valid_from=date(2026, 1, 1),
        )

        invoice = generate_invoice(self.participant, date(2026, 1, 1), date(2026, 1, 31))

        zero_item = invoice.items.get(description__startswith=zero_fee.name)
        credit_item = invoice.items.get(description__startswith=yearly_credit.name)

        self.assertEqual(zero_item.total_chf, Decimal("0.00"))
        self.assertEqual(credit_item.item_type, InvoiceItem.ItemType.CREDIT)
        self.assertEqual(credit_item.total_chf, Decimal("-10.00"))
        self.assertEqual(invoice.subtotal_chf, Decimal("-10.00"))
        self.assertEqual(invoice.total_chf, Decimal("-10.00"))

    def test_subtotal_rounds_to_chf_cent(self):
        tariff = Tariff.objects.create(
            zev=self.zev,
            name="Rounding Grid",
            category=TariffCategory.ENERGY,
            billing_mode=BillingMode.ENERGY,
            energy_type=EnergyType.GRID,
            valid_from=date(2026, 1, 1),
        )
        TariffPeriod.objects.create(
            tariff=tariff,
            period_type="flat",
            price_chf_per_kwh=Decimal("0.33333"),
        )

        MeterReading.objects.create(
            metering_point=self.consumption_mp,
            timestamp=datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc),
            energy_kwh=Decimal("3.0000"),
            direction=ReadingDirection.IN,
            resolution=ReadingResolution.FIFTEEN_MIN,
        )

        invoice = generate_invoice(self.participant, date(2026, 1, 1), date(2026, 1, 31))
        item = invoice.items.get(description=tariff.name)

        self.assertEqual(item.unit_price_chf, Decimal("0.33333"))
        self.assertEqual(item.total_chf, Decimal("1.00"))
        self.assertEqual(invoice.subtotal_chf, Decimal("1.00"))
        self.assertEqual(invoice.total_chf, Decimal("1.00"))


class InvoiceVatRateSelectionTests(TestCase):
    def setUp(self):
        self.owner = make_user("vat_owner", UserRole.ZEV_OWNER)
        self.zev = make_zev(self.owner, "VAT ZEV")
        self.participant = make_participant(self.zev, first="Vat", last="Case")

        self.consumption_mp = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH-VAT-CONS-1",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        MeteringPointAssignment.objects.create(
            metering_point=self.consumption_mp,
            participant=self.participant,
            valid_from=date(2026, 1, 1),
        )

        grid_tariff = Tariff.objects.create(
            zev=self.zev,
            name="Grid VAT",
            category=TariffCategory.ENERGY,
            billing_mode=BillingMode.ENERGY,
            energy_type=EnergyType.GRID,
            valid_from=date(2026, 1, 1),
        )
        TariffPeriod.objects.create(
            tariff=grid_tariff,
            period_type="flat",
            price_chf_per_kwh=Decimal("1.00000"),
        )

        MeterReading.objects.create(
            metering_point=self.consumption_mp,
            timestamp=datetime(2026, 1, 15, 12, 0, tzinfo=timezone.utc),
            energy_kwh=Decimal("10.0000"),
            direction=ReadingDirection.IN,
            resolution=ReadingResolution.FIFTEEN_MIN,
        )
        MeterReading.objects.create(
            metering_point=self.consumption_mp,
            timestamp=datetime(2026, 2, 15, 12, 0, tzinfo=timezone.utc),
            energy_kwh=Decimal("10.0000"),
            direction=ReadingDirection.IN,
            resolution=ReadingResolution.FIFTEEN_MIN,
        )

    def test_uses_rate_active_at_period_end_when_vat_number_present(self):
        self.zev.vat_number = "CHE-123.456.789"
        self.zev.save(update_fields=["vat_number"])

        VatRate.objects.create(rate=Decimal("0.0770"), valid_from=date(2024, 1, 1), valid_to=date(2026, 1, 31))
        VatRate.objects.create(rate=Decimal("0.0810"), valid_from=date(2026, 2, 1), valid_to=None)

        jan_invoice = generate_invoice(self.participant, date(2026, 1, 1), date(2026, 1, 31))
        feb_invoice = generate_invoice(self.participant, date(2026, 2, 1), date(2026, 2, 28))

        self.assertEqual(jan_invoice.subtotal_chf, Decimal("10.00"))
        self.assertEqual(jan_invoice.vat_rate, Decimal("0.0770"))
        self.assertEqual(jan_invoice.vat_chf, Decimal("0.77"))
        self.assertEqual(jan_invoice.total_chf, Decimal("10.77"))

        self.assertEqual(feb_invoice.subtotal_chf, Decimal("10.00"))
        self.assertEqual(feb_invoice.vat_rate, Decimal("0.0810"))
        self.assertEqual(feb_invoice.vat_chf, Decimal("0.81"))
        self.assertEqual(feb_invoice.total_chf, Decimal("10.81"))

    def test_vat_number_missing_results_in_zero_vat(self):
        VatRate.objects.create(rate=Decimal("0.0810"), valid_from=date(2026, 1, 1), valid_to=None)

        invoice = generate_invoice(self.participant, date(2026, 1, 1), date(2026, 1, 31))

        self.assertEqual(invoice.vat_rate, Decimal("0"))
        self.assertEqual(invoice.vat_chf, Decimal("0.00"))
        self.assertEqual(invoice.total_chf, invoice.subtotal_chf)
