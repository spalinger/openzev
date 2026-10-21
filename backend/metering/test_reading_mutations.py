"""Reading history can only change through the tracked import/deletion paths."""

from datetime import datetime, timezone
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from metering.models import ImportSource, MeterReading, QuarantinedReading
from metering.serializers import MeterReadingSerializer
from testing.helpers import authenticate, create_managed_zev, make_user
from zev.models import MeteringPoint
from zev.serializers import MeteringPointSerializer


class ReadingMutationPolicyTests(TestCase):
    def setUp(self):
        self.owner = make_user("reading_policy")
        self.zev = create_managed_zev(name="Reading policy", owner=self.owner)
        self.point = MeteringPoint.objects.create(zev=self.zev, meter_id="POLICY")
        self.client = APIClient()
        authenticate(self.client, self.owner)

    def reading(self, model=MeterReading):
        return model.objects.create(
            metering_point=self.point,
            timestamp=datetime(2025, 6, 10, tzinfo=timezone.utc),
            energy_kwh=1, import_source=ImportSource.SDATCH,
            source_document_id="ORIGINAL",
        )

    def test_generic_reading_writes_are_not_supported(self):
        reading = self.reading()
        endpoint = f"/api/v1/metering/readings/{reading.pk}/"
        payload = {"energy_kwh": "2.0000", "source_document_id": "FORGED"}
        for response in (
            self.client.post("/api/v1/metering/readings/", payload, format="json"),
            self.client.patch(endpoint, payload, format="json"),
            self.client.put(endpoint, payload, format="json"),
            self.client.delete(endpoint),
        ):
            self.assertEqual(response.status_code, 405, response.content)
        reading.refresh_from_db()
        self.assertEqual(reading.energy_kwh, 1)
        self.assertEqual(reading.source_document_id, "ORIGINAL")
        self.assertTrue(all(field.read_only for field in MeterReadingSerializer().fields.values()))

    def test_point_history_blocks_delete_and_billing_configuration_changes(self):
        for model in (MeterReading, QuarantinedReading):
            with self.subTest(stream=model.__name__):
                row = self.reading(model)
                endpoint = f"/api/v1/zev/metering-points/{self.point.pk}/"
                self.assertTrue(self.client.get(endpoint).json()["history_protected"])
                response = self.client.delete(endpoint)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertTrue(model.objects.filter(pk=row.pk).exists())
                response = self.client.patch(endpoint, {"meter_type": "production"}, format="json")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("meter_type", response.json())
                self.point.refresh_from_db()
                self.assertEqual(self.point.meter_type, "consumption")
                row.delete()

    def test_model_writes_cannot_bypass_history_protection(self):
        self.reading()
        other = create_managed_zev(name="Other", owner=self.owner)
        self.point.zev = other
        with self.assertRaises(ValidationError):
            self.point.save()
        self.point.refresh_from_db()
        with self.assertRaises(ValidationError):
            self.point.delete()

    def test_point_without_history_can_change_type_and_be_deleted(self):
        endpoint = f"/api/v1/zev/metering-points/{self.point.pk}/"
        response = self.client.patch(endpoint, {"meter_type": "production"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.client.delete(endpoint).status_code, 204)

    def test_patch_revalidates_fields_against_the_locked_configuration(self):
        self.point.meter_type = "bidirectional"
        self.point.save(update_fields=["meter_type"])
        original = MeteringPointSerializer.is_valid
        advanced = []

        def validate(serializer, *args, **kwargs):
            result = original(serializer, *args, **kwargs)
            if serializer.initial_data.get("has_behind_meter_generation") and not advanced:
                concurrent = MeteringPoint.objects.get(pk=self.point.pk)
                concurrent.meter_type = "consumption"
                concurrent.save(update_fields=["meter_type"])
                advanced.append(True)
            return result

        with patch.object(MeteringPointSerializer, "is_valid", validate):
            response = self.client.patch(
                f"/api/v1/zev/metering-points/{self.point.pk}/",
                {"has_behind_meter_generation": True}, format="json",
            )
        self.assertEqual(response.status_code, 400, response.content)
        self.point.refresh_from_db()
        self.assertEqual(self.point.meter_type, "consumption")
        self.assertFalse(self.point.has_behind_meter_generation)
