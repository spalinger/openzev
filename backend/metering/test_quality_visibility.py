"""Quality visibility: stored conditions and read-only held observations."""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

from rest_framework.test import APIClient
from django.test import TestCase

from accounts.models import UserRole
from metering.models import (
    ImportSource,
    MeterReading,
    QuarantinedReading,
    ReadingDirection,
)
from metering.views import QuarantinedReadingViewSet
from testing.helpers import authenticate as auth, create_managed_zev, make_user
from zev.models import (
    MeteringPoint,
    MeteringPointAssignment,
    MeteringPointType,
    Participant,
    ZevAccessGrant,
    ZevAccessRole,
)

RAW_URL = "/api/v1/metering/readings/raw-data/"
HELD_URL = "/api/v1/metering/held-readings/"


class QualityVisibilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = make_user("quality_owner", UserRole.USER)
        self.other_owner = make_user("quality_other_owner", UserRole.USER)
        self.participant_user = make_user("quality_participant", UserRole.USER)

        self.zev = create_managed_zev(
            name="Quality ZEV", owner=self.owner, zev_type="vzev", invoice_prefix="Q"
        )
        self.other_zev = create_managed_zev(
            name="Other Quality ZEV", owner=self.other_owner, zev_type="vzev", invoice_prefix="O"
        )

        self.point = MeteringPoint.objects.create(
            zev=self.zev, meter_id="CH-QUALITY-1", meter_type=MeteringPointType.CONSUMPTION
        )
        self.other_point = MeteringPoint.objects.create(
            zev=self.other_zev, meter_id="CH-QUALITY-2", meter_type=MeteringPointType.CONSUMPTION
        )
        self.participant = Participant.objects.create(
            zev=self.zev,
            user=self.participant_user,
            first_name="Quality",
            last_name="Reader",
            email="quality.reader@example.com",
            valid_from=date(2026, 1, 1),
        )
        MeteringPointAssignment.objects.create(
            metering_point=self.point,
            participant=self.participant,
            valid_from=date(2026, 1, 1),
        )

        self.batch = uuid.uuid4()
        self.ts_measured = datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)
        self.ts_estimated = datetime(2026, 1, 1, 0, 15, tzinfo=timezone.utc)
        self.ts_zero = datetime(2026, 1, 1, 0, 30, tzinfo=timezone.utc)
        self.ts_held_only = datetime(2026, 1, 1, 0, 45, tzinfo=timezone.utc)

        MeterReading.objects.create(
            metering_point=self.point,
            timestamp=self.ts_measured,
            energy_kwh=Decimal("1.0000"),
            direction=ReadingDirection.IN,
            condition="",
        )
        MeterReading.objects.create(
            metering_point=self.point,
            timestamp=self.ts_estimated,
            energy_kwh=Decimal("2.0000"),
            direction=ReadingDirection.IN,
            condition="56",
        )
        MeterReading.objects.create(
            metering_point=self.point,
            timestamp=self.ts_zero,
            energy_kwh=Decimal("0.0000"),
            direction=ReadingDirection.IN,
            condition="",
        )

        self.held_measured = QuarantinedReading.objects.create(
            metering_point=self.point,
            timestamp=self.ts_measured,
            energy_kwh=Decimal("9.0000"),
            direction=ReadingDirection.IN,
            condition="21",
            business_reason="E88",
            import_source=ImportSource.SDATCH,
            import_batch=self.batch,
            source_document_id="HELD-DOC",
            source_delivery_id="HELD-DELIVERY",
            source_creation=datetime(2025, 12, 31, 12, 0, tzinfo=timezone.utc),
        )
        self.held_estimated = QuarantinedReading.objects.create(
            metering_point=self.point,
            timestamp=self.ts_estimated,
            energy_kwh=Decimal("8.0000"),
            direction=ReadingDirection.IN,
            condition="56",
            business_reason="C38",
            import_source=ImportSource.SDATCH,
            import_batch=self.batch,
            source_document_id="HELD-DOC-2",
            source_delivery_id="HELD-DELIVERY-2",
        )
        self.held_zero_accepted = QuarantinedReading.objects.create(
            metering_point=self.point,
            timestamp=self.ts_zero,
            energy_kwh=Decimal("7.0000"),
            direction=ReadingDirection.IN,
            condition="21",
            business_reason="E88",
            import_source=ImportSource.SDATCH,
            import_batch=self.batch,
        )
        self.held_only = QuarantinedReading.objects.create(
            metering_point=self.point,
            timestamp=self.ts_held_only,
            energy_kwh=Decimal("6.0000"),
            direction=ReadingDirection.IN,
            condition="21",
            business_reason="E88",
            import_source=ImportSource.SDATCH,
            import_batch=self.batch,
        )
        self.other_held = QuarantinedReading.objects.create(
            metering_point=self.other_point,
            timestamp=self.ts_measured,
            energy_kwh=Decimal("5.0000"),
            direction=ReadingDirection.IN,
            condition="21",
            import_source=ImportSource.SDATCH,
        )

    def test_raw_detail_exposes_the_stored_condition(self):
        MeterReading.objects.filter(timestamp=self.ts_zero).update(condition="99")
        auth(self.client, self.owner)
        response = self.client.get(
            RAW_URL, {"metering_point": str(self.point.id), "date": "2026-01-01"}
        )

        self.assertEqual(response.status_code, 200)
        by_timestamp = {row["timestamp"]: row for row in response.data}
        self.assertEqual(by_timestamp[self.ts_measured.isoformat()]["condition"], "")
        self.assertEqual(by_timestamp[self.ts_estimated.isoformat()]["condition"], "56")
        self.assertEqual(by_timestamp[self.ts_zero.isoformat()]["condition"], "99")
        # The summary endpoint keeps its compact shape and its totals.
        summary = self.client.get(
            RAW_URL,
            {
                "metering_point": str(self.point.id),
                "date_from": "2026-01-01",
                "date_to": "2026-01-01",
            },
        )
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(set(summary.data[0]), {"date", "in_kwh", "out_kwh", "readings_count"})
        self.assertEqual(summary.data[0]["readings_count"], 3)
        self.assertEqual(summary.data[0]["in_kwh"], 3.0)

    def test_held_endpoint_returns_scoped_rows_with_provenance(self):
        auth(self.client, self.owner)
        response = self.client.get(HELD_URL, {"metering_point": str(self.point.id)})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 4)
        rows = {row["id"]: row for row in response.data["results"]}
        self.assertNotIn(str(self.other_held.id), rows)

        held = rows[str(self.held_only.id)]
        self.assertEqual(held["meter_id"], "CH-QUALITY-1")
        self.assertEqual(held["condition"], "21")
        self.assertEqual(held["business_reason"], "E88")
        self.assertEqual(held["import_batch"], str(self.batch))
        self.assertEqual(held["source_document_id"], "")
        self.assertIsNone(held["source_creation"])
        self.assertIsNotNone(held["created_at"])

    def test_held_endpoint_shows_accepted_coexistence_and_distinguishes_zero(self):
        auth(self.client, self.owner)
        response = self.client.get(HELD_URL, {"metering_point": str(self.point.id)})
        rows = {row["id"]: row for row in response.data["results"]}

        coexisting = rows[str(self.held_measured.id)]
        self.assertEqual(coexisting["accepted_energy_kwh"], "1.0000")

        zero = rows[str(self.held_zero_accepted.id)]
        self.assertEqual(zero["accepted_energy_kwh"], "0.0000")

        missing = rows[str(self.held_only.id)]
        self.assertIsNone(missing["accepted_energy_kwh"])

    def test_admins_and_granted_non_owner_readers_can_list_and_retrieve(self):
        for role in (UserRole.ADMIN, ZevAccessRole.MANAGER, ZevAccessRole.VIEWER):
            with self.subTest(role=role):
                user = make_user(f"quality_reader_{role}", UserRole.ADMIN if role == UserRole.ADMIN else UserRole.USER)
                if not user.is_admin:
                    ZevAccessGrant.objects.create(zev=self.zev, user=user, role=role)
                auth(self.client, user)
                listed = self.client.get(HELD_URL, {"zev_id": str(self.zev.pk)})
                self.assertEqual(listed.status_code, 200)
                self.assertEqual(listed.data["count"], 4)
                self.assertTrue(all(str(row["metering_point"]) == str(self.point.pk) for row in listed.data["results"]))
                detail = self.client.get(f"{HELD_URL}{self.held_only.pk}/")
                self.assertEqual(detail.status_code, 200)
                self.assertEqual(detail.data["id"], str(self.held_only.pk))

    def test_held_pages_report_the_effective_server_page_size(self):
        auth(self.client, self.owner)
        with patch.object(QuarantinedReadingViewSet.pagination_class, "page_size", 3):
            first = self.client.get(HELD_URL, {"metering_point": str(self.point.pk)})
            last = self.client.get(HELD_URL, {"metering_point": str(self.point.pk), "page": 2})
        self.assertEqual(first.data["page_size"], 3)
        self.assertEqual(len(first.data["results"]), 3)
        self.assertEqual(last.data["page_size"], 3)
        self.assertEqual(len(last.data["results"]), 1)

    def test_held_endpoint_filters_and_orders_deterministically(self):
        auth(self.client, self.owner)
        paged_start = datetime(2026, 1, 2, 0, 0, tzinfo=timezone.utc)
        QuarantinedReading.objects.bulk_create([
            QuarantinedReading(
                metering_point=self.point,
                timestamp=paged_start + timedelta(minutes=15 * index),
                energy_kwh=Decimal("1.0000"),
                direction=ReadingDirection.IN,
                condition="21",
                import_batch=self.batch,
            )
            for index in range(55)
        ])

        first = self.client.get(HELD_URL, {"metering_point": str(self.point.id)})
        second = self.client.get(
            HELD_URL, {"metering_point": str(self.point.id), "page": 2}
        )

        self.assertEqual(first.data["count"], 59)
        self.assertEqual(len(first.data["results"]), 50)
        self.assertEqual(len(second.data["results"]), 9)
        stamps = [row["timestamp"] for row in first.data["results"]]
        self.assertEqual(stamps, sorted(stamps))

        filtered = self.client.get(
            HELD_URL,
            {
                "metering_point": str(self.point.id),
                "date_from": "2026-01-02",
                "date_to": "2026-01-02",
                "import_batch": str(self.batch),
            },
        )
        self.assertEqual(filtered.data["count"], 55)

        wrong_batch = self.client.get(
            HELD_URL,
            {
                "metering_point": str(self.point.id),
                "import_batch": str(uuid.uuid4()),
            },
        )
        self.assertEqual(wrong_batch.data["count"], 0)

    def test_held_date_filters_use_swiss_midnight_and_dst_day_length(self):
        auth(self.client, self.owner)
        for day, start, end in (
            ("2026-01-01", datetime(2025, 12, 31, 23, tzinfo=timezone.utc),
             datetime(2026, 1, 1, 23, tzinfo=timezone.utc)),
            ("2026-10-25", datetime(2026, 10, 24, 22, tzinfo=timezone.utc),
             datetime(2026, 10, 25, 23, tzinfo=timezone.utc)),
        ):
            with self.subTest(day=day):
                batch = uuid.uuid4()
                rows = QuarantinedReading.objects.bulk_create([
                    QuarantinedReading(
                        metering_point=self.point, timestamp=timestamp,
                        energy_kwh="1.0000", condition="21", import_batch=batch,
                    )
                    for timestamp in (start - timedelta(minutes=15), start, end - timedelta(minutes=15), end)
                ])
                result = self.client.get(HELD_URL, {
                    "import_batch": str(batch), "date_from": day, "date_to": day,
                }).data
                self.assertEqual(result["count"], 2)
                self.assertEqual({row["id"] for row in result["results"]}, {str(row.id) for row in rows[1:3]})

    def test_held_endpoint_is_read_only(self):
        auth(self.client, self.owner)
        detail = f"{HELD_URL}{self.held_only.id}/"

        self.assertEqual(self.client.post(HELD_URL, {}).status_code, 405)
        self.assertEqual(self.client.put(detail, {"energy_kwh": "1.0"}).status_code, 405)
        self.assertEqual(self.client.patch(detail, {"energy_kwh": "1.0"}).status_code, 405)
        self.assertEqual(self.client.delete(detail).status_code, 405)

    def test_participants_do_not_gain_held_observation_access(self):
        auth(self.client, self.participant_user)

        listed = self.client.get(HELD_URL, {"metering_point": str(self.point.id)})
        detail = self.client.get(f"{HELD_URL}{self.held_only.id}/")

        self.assertEqual(listed.status_code, 403)
        self.assertEqual(detail.status_code, 403)

    def test_cross_zev_isolation_and_direct_retrieval(self):
        auth(self.client, self.owner)

        filtered = self.client.get(HELD_URL, {"zev_id": str(self.other_zev.id)})
        detail = self.client.get(f"{HELD_URL}{self.other_held.id}/")

        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.data["count"], 0)
        self.assertEqual(detail.status_code, 404)

        own_detail = self.client.get(f"{HELD_URL}{self.held_only.id}/")
        self.assertEqual(own_detail.status_code, 200)
        self.assertEqual(own_detail.data["id"], str(self.held_only.id))

    def test_viewer_grant_does_not_reveal_a_participant_community(self):
        # A grant elsewhere must not open the participant's held readings.
        ZevAccessGrant.objects.create(
            zev=self.other_zev, user=self.participant_user, role=ZevAccessRole.VIEWER
        )
        auth(self.client, self.participant_user)
        response = self.client.get(HELD_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], str(self.other_held.id))
        self.assertEqual(self.client.get(f"{HELD_URL}{self.held_only.id}/").status_code, 404)

    def test_invalid_filters_are_rejected(self):
        auth(self.client, self.owner)
        for params in (
            {"metering_point": "not-a-uuid"},
            {"import_batch": "not-a-uuid"},
            {"date_from": "not-a-date"},
            {"date_to": "not-a-date"},
        ):
            with self.subTest(params=params):
                response = self.client.get(HELD_URL, params)
                self.assertEqual(response.status_code, 400)
