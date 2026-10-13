"""Meter identity unambiguity.

An SDAT source meter ID must resolve to exactly one metering point: primary
and secondary IDs collide across columns, not just within them. These tests
pin the shared validation path used by the API (and, via ``full_clean``, the
archive importer) plus the lookup/remediation contract consumed by the
SDAT-CH importer.
"""

from datetime import date
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import UserRole
from testing.helpers import authenticate as auth, create_managed_zev, make_user
from zev.models import (
    AmbiguousMeterIdentity,
    MeteringPoint,
    MeteringPointType,
    Participant,
    ZevAccessGrant,
    ZevAccessRole,
    find_ambiguous_meter_identities,
    normalize_secondary_meter_id,
    resolve_metering_point,
)

METERING_POINTS = "/api/v1/zev/metering-points/"


def _point(zev, meter_id, secondary=None):
    return MeteringPoint.objects.create(
        zev=zev,
        meter_id=meter_id,
        secondary_meter_id=secondary,
        meter_type=MeteringPointType.CONSUMPTION,
    )


class _TwoZeVs(TestCase):
    def setUp(self):
        self.admin = make_user("mi_admin", UserRole.ADMIN)
        self.owner = make_user("mi_owner", UserRole.USER)
        self.other_owner = make_user("mi_other", UserRole.USER)
        self.viewer = make_user("mi_viewer", UserRole.USER)
        self.zev = create_managed_zev(name="Identity ZEV", owner=self.owner)
        self.other_zev = create_managed_zev(name="Other Identity ZEV", owner=self.other_owner)
        ZevAccessGrant.objects.create(
            zev=self.zev, user=self.viewer, role=ZevAccessRole.VIEWER,
            valid_from=date(2026, 1, 1),
        )
        self.client = APIClient()
        auth(self.client, self.owner)
        self.admin_client = APIClient()
        auth(self.admin_client, self.admin)

    def post(self, payload, client=None):
        return (client or self.client).post(METERING_POINTS, payload, format="json")

    def base_payload(self, meter_id, secondary=None, zev=None):
        payload = {
            "zev": str((zev or self.zev).id),
            "meter_id": meter_id,
            "meter_type": "consumption",
        }
        if secondary is not None:
            payload["secondary_meter_id"] = secondary
        return payload


class MeterIdentityCreateTests(_TwoZeVs):
    def test_setup_wizard_rejects_collisions_and_rolls_back(self):
        from django.contrib.auth import get_user_model
        from zev.models import Zev

        _point(self.other_zev, "MI-WIZARD-PRIMARY", secondary="MI-WIZARD-SECONDARY")
        for ids in (("MI-WIZARD-PRIMARY",), ("MI-WIZARD-SECONDARY",), ("MI-WIZARD-NEW", "MI-WIZARD-NEW")):
            with self.subTest(ids=ids):
                response = self.admin_client.post("/api/v1/zev/zevs/create-with-owner/", {
                    "name": "Rejected wizard ZEV", "start_date": "2026-01-01",
                    "zev_type": "zev", "billing_interval": "monthly",
                    "owner": {"first_name": "New", "last_name": "Owner", "email": "wizard@example.com"},
                    "metering_points": [{"meter_id": value, "meter_type": "consumption"} for value in ids],
                }, format="json")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("meter_id", response.json()["metering_points"])
                self.assertFalse(Zev.objects.filter(name="Rejected wizard ZEV").exists())
                self.assertFalse(get_user_model().objects.filter(email="wizard@example.com").exists())
                self.assertFalse(MeteringPoint.objects.filter(meter_id="MI-WIZARD-NEW").exists())

    def test_duplicate_primary_rejected(self):
        _point(self.zev, "MI-PRIMARY-1")
        response = self.post(self.base_payload("MI-PRIMARY-1"))
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("meter_id", response.json())

    def test_secondary_matching_other_primary_rejected(self):
        _point(self.zev, "MI-PRIMARY-2")
        response = self.post(self.base_payload("MI-NEW-2", secondary="MI-PRIMARY-2"))
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("secondary_meter_id", response.json())

    def test_primary_matching_other_secondary_rejected(self):
        _point(self.zev, "MI-PRIMARY-3", secondary="MI-SECONDARY-3")
        response = self.post(self.base_payload("MI-SECONDARY-3"))
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("meter_id", response.json())

    def test_duplicate_secondary_rejected(self):
        _point(self.zev, "MI-PRIMARY-4", secondary="MI-SECONDARY-4")
        response = self.post(self.base_payload("MI-NEW-4", secondary="MI-SECONDARY-4"))
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("secondary_meter_id", response.json())

    def test_secondary_equal_to_own_primary_rejected(self):
        response = self.post(self.base_payload("MI-SELF-5", secondary="MI-SELF-5"))
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("secondary_meter_id", response.json())

    def test_cross_zev_collision_rejected_without_tenant_leak(self):
        _point(self.other_zev, "MI-FOREIGN-6", secondary="MI-FOREIGN-SEC-6")
        for payload in (
            self.base_payload("MI-FOREIGN-6"),
            self.base_payload("MI-NEW-6", secondary="MI-FOREIGN-SEC-6"),
            self.base_payload("MI-NEW-6B", secondary="MI-FOREIGN-6"),
        ):
            response = self.post(payload)
            self.assertEqual(response.status_code, 400, response.content)
            body = str(response.json())
            self.assertNotIn("Other Identity ZEV", body)
            self.assertNotIn("other@example.com", body)

    def test_blank_and_null_secondary_accepted_and_stored_null(self):
        for suffix, secondary in (("OMITTED", None), ("NULL", None), ("EMPTY", ""), ("SPACE", "   ")):
            payload = self.base_payload(f"MI-BLANK-{suffix}", secondary=secondary)
            if suffix == "NULL":
                payload["secondary_meter_id"] = None
            response = self.post(payload)
            self.assertEqual(response.status_code, 201, response.content)
            stored = MeteringPoint.objects.get(meter_id=payload["meter_id"])
            self.assertIsNone(stored.secondary_meter_id)

    def test_distinct_secondary_accepted(self):
        _point(self.zev, "MI-PRIMARY-8", secondary="MI-SECONDARY-8")
        response = self.post(self.base_payload("MI-NEW-8", secondary="MI-OTHER-SEC-8"))
        self.assertEqual(response.status_code, 201, response.content)

    def test_unrelated_integrity_error_is_not_reported_as_an_identity_conflict(self):
        with patch("zev.models.MeteringPoint.save", side_effect=IntegrityError("audit failure")):
            with self.assertRaises(IntegrityError):
                self.post(self.base_payload("MI-AUDIT"))

    def test_same_column_race_returns_validation_error_and_rolls_back(self):
        from zev.serializers import MeteringPointSerializer

        validate = MeteringPointSerializer.validate

        def concurrent_validate(serializer, attrs):
            result = validate(serializer, attrs)
            _point(self.zev, attrs["meter_id"])
            return result

        with patch.object(MeteringPointSerializer, "validate", concurrent_validate):
            response = self.post(self.base_payload("MI-RACE"))
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("meter_id", response.json())
        self.assertEqual(MeteringPoint.objects.filter(meter_id="MI-RACE").count(), 1)


class MeterIdentityUpdateTests(_TwoZeVs):
    def setUp(self):
        super().setUp()
        self.first = _point(self.zev, "MIU-FIRST", secondary="MIU-SEC-FIRST")
        self.second = _point(self.zev, "MIU-SECOND", secondary="MIU-SEC-SECOND")

    def patch(self, point, payload, client=None):
        return (client or self.client).patch(
            f"{METERING_POINTS}{point.id}/", payload, format="json"
        )

    def test_update_secondary_onto_other_primary_rejected(self):
        response = self.patch(self.second, {"secondary_meter_id": "MIU-FIRST"})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("secondary_meter_id", response.json())

    def test_update_primary_onto_other_secondary_rejected(self):
        response = self.patch(self.second, {"meter_id": "MIU-SEC-FIRST"})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("meter_id", response.json())

    def test_update_primary_onto_other_primary_rejected(self):
        response = self.patch(self.second, {"meter_id": "MIU-FIRST"})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("meter_id", response.json())

    def test_update_secondary_onto_other_secondary_rejected(self):
        response = self.patch(self.second, {"secondary_meter_id": "MIU-SEC-FIRST"})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("secondary_meter_id", response.json())

    def test_update_secondary_equal_to_own_primary_rejected(self):
        response = self.patch(self.first, {"secondary_meter_id": "MIU-FIRST"})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("secondary_meter_id", response.json())

    def test_unchanged_update_succeeds(self):
        response = self.patch(
            self.first,
            {"meter_id": "MIU-FIRST", "secondary_meter_id": "MIU-SEC-FIRST"},
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_update_to_distinct_secondary_succeeds(self):
        response = self.patch(self.first, {"secondary_meter_id": "MIU-SEC-NEW"})
        self.assertEqual(response.status_code, 200, response.content)
        self.first.refresh_from_db()
        self.assertEqual(self.first.secondary_meter_id, "MIU-SEC-NEW")

    def test_update_can_clear_secondary_with_null_or_blank(self):
        for secondary in (None, ""):
            response = self.patch(self.first, {"secondary_meter_id": secondary})
            self.assertEqual(response.status_code, 200, response.content)
            self.first.refresh_from_db()
            self.assertIsNone(self.first.secondary_meter_id)
            # Restore for the next iteration.
            self.first.secondary_meter_id = "MIU-SEC-FIRST"
            self.first.save()

    def test_cross_zev_update_collision_rejected_without_tenant_leak(self):
        _point(self.other_zev, "MIU-FOREIGN")
        response = self.patch(self.first, {"secondary_meter_id": "MIU-FOREIGN"})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertNotIn("Other Identity ZEV", str(response.json()))


class MeterIdentityModelTests(_TwoZeVs):
    def test_normalize_secondary(self):
        self.assertIsNone(normalize_secondary_meter_id(None))
        self.assertIsNone(normalize_secondary_meter_id(""))
        self.assertIsNone(normalize_secondary_meter_id("   "))
        self.assertEqual(normalize_secondary_meter_id("  MI-X  "), "MI-X")

    def test_save_normalizes_blank_without_full_clean(self):
        point = MeteringPoint(
            zev=self.zev, meter_id="MIM-SAVE-1", secondary_meter_id="  ",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        point.save()
        point.refresh_from_db()
        self.assertIsNone(point.secondary_meter_id)

    def test_full_clean_rejects_cross_column_collision(self):
        _point(self.zev, "MIM-PRIMARY-1", secondary="MIM-SEC-1")
        candidate = MeteringPoint(
            zev=self.zev, meter_id="MIM-NEW-1", secondary_meter_id="MIM-PRIMARY-1",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        with self.assertRaises(ValidationError) as raised:
            candidate.full_clean(exclude=["building"])
        self.assertIn("secondary_meter_id", raised.exception.message_dict)

    def test_full_clean_rejects_own_primary_redundancy(self):
        candidate = MeteringPoint(
            zev=self.zev, meter_id="MIM-SELF-1", secondary_meter_id="MIM-SELF-1",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        with self.assertRaises(ValidationError) as raised:
            candidate.full_clean(exclude=["building"])
        self.assertIn("secondary_meter_id", raised.exception.message_dict)

    def test_full_clean_allows_unchanged_self(self):
        point = _point(self.zev, "MIM-SELF-2", secondary="MIM-SEC-2")
        point.full_clean()  # must not raise

    def test_db_check_constraint_rejects_self_redundant_direct_write(self):
        point = _point(self.zev, "MIM-DB-1")
        with self.assertRaises(IntegrityError), transaction.atomic():
            MeteringPoint.objects.filter(pk=point.pk).update(
                secondary_meter_id="MIM-DB-1"
            )

    def test_shared_validation_rejects_duplicate_primary(self):
        from zev.models import validate_meter_identities

        _point(self.zev, "MIM-DUPLICATE")
        with self.assertRaises(ValidationError) as raised:
            validate_meter_identities(meter_id="MIM-DUPLICATE")
        self.assertIn("meter_id", raised.exception.message_dict)

    def test_partial_save_does_not_write_an_excluded_secondary_id(self):
        point = _point(self.zev, "MIM-PARTIAL", secondary="MIM-ORIGINAL")
        point.secondary_meter_id = " MIM-UNSAVED "
        point.location_description = "Updated location"
        point.save(update_fields=["location_description"])
        point.refresh_from_db()
        self.assertEqual(point.secondary_meter_id, "MIM-ORIGINAL")
        self.assertEqual(point.location_description, "Updated location")
        point.secondary_meter_id = "  "
        point.save(update_fields=["secondary_meter_id"])
        point.refresh_from_db()
        self.assertIsNone(point.secondary_meter_id)


class MeterIdentityLookupContractTests(_TwoZeVs):
    """Published lookup contract for the SDAT-CH importer."""

    def test_resolve_matches_primary_and_secondary(self):
        point = _point(self.zev, "MIL-PRIMARY", secondary="MIL-SECONDARY")
        self.assertEqual(resolve_metering_point(self.zev, "MIL-PRIMARY"), point)
        self.assertEqual(resolve_metering_point(self.zev, "MIL-SECONDARY"), point)

    def test_resolve_unknown_returns_none(self):
        self.assertIsNone(resolve_metering_point(self.zev, "MIL-UNKNOWN"))

    def test_resolve_is_scoped_to_the_given_zev(self):
        _point(self.other_zev, "MIL-FOREIGN")
        self.assertIsNone(resolve_metering_point(self.zev, "MIL-FOREIGN"))

    def test_resolve_refuses_to_guess_on_legacy_ambiguity(self):
        first = _point(self.zev, "MIL-AMB-PRIMARY")
        second = _point(self.zev, "MIL-AMB-OTHER")
        # Legacy / direct-DB state that current validation forbids: bypass it
        # without deleting or reassigning anything.
        MeteringPoint.objects.filter(pk=second.pk).update(
            secondary_meter_id="MIL-AMB-PRIMARY"
        )
        with self.assertRaises(AmbiguousMeterIdentity) as raised:
            resolve_metering_point(self.zev, "MIL-AMB-PRIMARY")
        self.assertEqual(
            set(raised.exception.point_ids), {first.pk, second.pk}
        )

    def test_find_ambiguous_meter_identities_surfaces_legacy_state(self):
        first = _point(self.zev, "MIL-SCAN-A")
        second = _point(self.zev, "MIL-SCAN-B")
        self.assertEqual(find_ambiguous_meter_identities(), [])
        MeteringPoint.objects.filter(pk=second.pk).update(
            secondary_meter_id="MIL-SCAN-A"
        )
        found = find_ambiguous_meter_identities()
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["identity"], "MIL-SCAN-A")
        self.assertEqual(set(found[0]["point_ids"]), {first.pk, second.pk})
        # Remediation is explicit, never a guess: the helper reports, and the
        # data is untouched.
        self.assertTrue(
            MeteringPoint.objects.filter(pk=second.pk).exists()
        )

    def test_check_meter_identities_command_reports_state(self):
        out_clean = self._run_check_command(expect_failure=False)
        self.assertIn("No ambiguous", out_clean)
        second = _point(self.zev, "MIL-CMD-B")
        _point(self.zev, "MIL-CMD-A")
        # Cross-point legacy collision: forbidden by runtime validation but
        # not expressible as a schema invariant, so a direct-DB write lands.
        MeteringPoint.objects.filter(pk=second.pk).update(
            secondary_meter_id="MIL-CMD-A"
        )
        out_ambiguous = self._run_check_command(expect_failure=True)
        self.assertIn("MIL-CMD-A", out_ambiguous)

    def _run_check_command(self, expect_failure):
        from io import StringIO

        from django.core.management.base import CommandError

        out = StringIO()
        if expect_failure:
            with self.assertRaises(CommandError):
                call_command("check_meter_identities", stdout=out)
        else:
            call_command("check_meter_identities", stdout=out)
        return out.getvalue()


class MeterIdentityPermissionsIntactTests(_TwoZeVs):
    def setUp(self):
        super().setUp()
        self.participant_user = make_user("mi_participant", UserRole.USER)
        self.participant = Participant.objects.create(
            zev=self.zev, user=self.participant_user, first_name="Ima",
            last_name="Participant", email="ima@example.com",
            valid_from=date(2026, 1, 1),
        )
        self.meter = _point(self.zev, "MIP-METER")

    def test_viewer_and_participant_cannot_create(self):
        viewer_client = APIClient()
        auth(viewer_client, self.viewer)
        participant_client = APIClient()
        auth(participant_client, self.participant_user)
        for client in (viewer_client, participant_client):
            response = client.post(
                METERING_POINTS, self.base_payload("MIP-NEW"), format="json"
            )
            self.assertEqual(response.status_code, 403, response.content)
        self.assertFalse(MeteringPoint.objects.filter(meter_id="MIP-NEW").exists())

    def test_manager_cannot_write_into_disabled_zev_but_admin_can(self):
        self.zev.disabled_at = timezone.now()
        self.zev.save()
        refused_create = self.post(self.base_payload("MIP-DISABLED"))
        self.assertEqual(refused_create.status_code, 400, refused_create.content)
        refused_patch = self.client.patch(
            f"{METERING_POINTS}{self.meter.id}/",
            {"location_description": "Top floor"},
            format="json",
        )
        self.assertEqual(refused_patch.status_code, 403, refused_patch.content)
        admin_create = self.admin_client.post(
            METERING_POINTS, self.base_payload("MIP-DISABLED", zev=self.zev),
            format="json",
        )
        self.assertEqual(admin_create.status_code, 201, admin_create.content)
