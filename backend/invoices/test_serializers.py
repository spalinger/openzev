from decimal import Decimal

from django.test import TestCase

from accounts.models import UserRole
from invoices.models import InvoiceItem, InvoiceStatus
from invoices.serializers import InvoiceSerializer
from invoices.test_helpers import make_invoice, make_participant, make_user, make_zev
from tariffs.models import TariffCategory


class InvoiceDescriptionSerializationTests(TestCase):
    def test_serializer_strips_period_suffix_for_legacy_item_descriptions(self):
        owner = make_user("desc_owner", UserRole.ZEV_OWNER)
        zev = make_zev(owner, "Description ZEV")
        participant = make_participant(zev, first="Des", last="Crip")
        invoice = make_invoice(zev, participant, InvoiceStatus.DRAFT)

        InvoiceItem.objects.create(
            invoice=invoice,
            item_type=InvoiceItem.ItemType.GRID_ENERGY,
            tariff_category=TariffCategory.GRID_FEES,
            description="Grid usage fee 2026-01-01 – 2026-01-31",
            quantity_kwh=Decimal("4.0000"),
            unit="kWh",
            unit_price_chf=Decimal("0.05000"),
            total_chf=Decimal("0.20"),
        )

        serialized = InvoiceSerializer(invoice).data

        self.assertEqual(serialized["items"][0]["description"], "Grid usage fee")
