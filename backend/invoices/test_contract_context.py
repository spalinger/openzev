from datetime import date
from unittest.mock import patch

from django.test import TestCase

from accounts.models import UserRole
from invoices.contract_pdf import _build_contract_context
from invoices.test_helpers import make_participant, make_user, make_zev
from zev.models import MeteringPoint, MeteringPointAssignment, MeteringPointType


class ContractPdfContextTests(TestCase):
    def setUp(self):
        self.owner = make_user("contract_owner", UserRole.ZEV_OWNER)
        self.zev = make_zev(self.owner, "Contract ZEV")
        self.participant = make_participant(self.zev, first="Future", last="Participant")

    def test_future_metering_point_assignments_are_included_in_contract_context(self):
        current_mp = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH-CONTRACT-CURRENT",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        future_mp = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH-CONTRACT-FUTURE",
            meter_type=MeteringPointType.PRODUCTION,
        )
        past_mp = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH-CONTRACT-PAST",
            meter_type=MeteringPointType.CONSUMPTION,
        )

        MeteringPointAssignment.objects.create(
            metering_point=current_mp,
            participant=self.participant,
            valid_from=date(2026, 1, 1),
        )
        MeteringPointAssignment.objects.create(
            metering_point=future_mp,
            participant=self.participant,
            valid_from=date(2026, 6, 1),
        )
        MeteringPointAssignment.objects.create(
            metering_point=past_mp,
            participant=self.participant,
            valid_from=date(2025, 1, 1),
            valid_to=date(2026, 2, 28),
        )

        with patch("invoices.contract_pdf.date") as mocked_date:
            mocked_date.today.return_value = date(2026, 4, 15)
            context = _build_contract_context(self.participant)

        self.assertEqual(
            [mp.meter_id for mp in context["consumption_mps"]],
            ["CH-CONTRACT-CURRENT"],
        )
        self.assertEqual(
            [mp.meter_id for mp in context["production_mps"]],
            ["CH-CONTRACT-FUTURE"],
        )
