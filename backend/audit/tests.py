from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient, APIRequestFactory
from django.urls import resolve
from accounts.authentication import ApiKeyAuthentication
from accounts.jwt_utils import make_jwt_for_user

from accounts.models import FeatureFlag, UserRole
from accounts.test_api_keys import create_api_key
from accounts.throttling import ApiKeyRateThrottle, AuditListThrottle
from metering.models import MeterReading
from invoices.models import Invoice, InvoiceStatus
from tariffs.models import Tariff, TariffCategory, BillingMode
from zev.models import (
    MeteringPoint, MeteringPointAssignment, MeteringPointType, Participant,
    Party, PartyRole, ZevAccessGrant, ZevAccessRole, ZevPartyRole,
)

from audit.models import AuditActionCategory, AuditEvent, AuditEventStatus
from audit.services import (
    build_diff,
    build_instance_snapshot,
    infer_zev,
    record_audit_event,
    redact_metadata,
)
from zev.serializers import ParticipantSerializer


from testing.helpers import authenticate as auth, make_user, create_managed_zev


class AuditEventModelTests(TestCase):
    def setUp(self):
        self.owner = make_user("audit_owner", UserRole.USER)
        self.admin = make_user("audit_admin", UserRole.ADMIN)
        self.zev = create_managed_zev(name="Audit ZEV", owner=self.owner)

    def test_audit_event_orders_by_newest_first(self):
        old_event = AuditEvent.objects.create(
            action_category=AuditActionCategory.SYSTEM,
            action_type="system.old",
            target_type="system.Event",
            summary="old",
            zev=self.zev,
        )
        new_event = AuditEvent.objects.create(
            action_category=AuditActionCategory.SYSTEM,
            action_type="system.new",
            target_type="system.Event",
            summary="new",
            zev=self.zev,
        )

        AuditEvent.objects.filter(pk=old_event.pk).update(created_at=timezone.now() - timedelta(days=1))
        AuditEvent.objects.filter(pk=new_event.pk).update(created_at=timezone.now())

        events = list(AuditEvent.objects.all())
        self.assertEqual(events[0].pk, new_event.pk)
        self.assertEqual(events[1].pk, old_event.pk)

    def test_audit_event_persists_actor_and_target_snapshots(self):
        event = record_audit_event(
            action_category=AuditActionCategory.GOVERNANCE,
            action_type="zev.update",
            target_type="zev.Zev",
            target_id=str(self.zev.id),
            target_display=self.zev.name,
            summary="Updated zev",
            user=self.admin,
            zev=self.zev,
        )

        self.admin.username = "changed_name"
        self.admin.save(update_fields=["username"])
        self.zev.name = "Changed ZEV"
        self.zev.save(update_fields=["name"])

        event.refresh_from_db()
        self.assertIn("audit_admin", event.actor_display)
        self.assertEqual(event.target_display, "Audit ZEV")

    def test_audit_event_preserves_deleted_actor_snapshot(self):
        self.admin.delete()
        event = record_audit_event(
            action_category=AuditActionCategory.AUTH,
            action_type="user.delete",
            target_type="accounts.User",
            summary="Denied deletion by deleted caller.",
            status=AuditEventStatus.DENIED,
            user=self.admin,
        )

        self.assertIsNone(event.actor_user_id)
        self.assertEqual(event.actor_display, self.admin.email)
        self.assertEqual(event.actor_role_snapshot, UserRole.ADMIN)

    def test_redaction_omits_secret_fields(self):
        redacted = redact_metadata(
            {
                "password": "secret",
                "Password": "secret",
                "user_password": "secret",
                "access_token": "secret",
                "api_key_value": "secret",
                "client_secret": "very-secret",
                "bank_iban": "CH9300762011623852957",
                "safe_field": "safe",
            }
        )
        self.assertNotIn("password", redacted)
        for key in ("Password", "user_password", "access_token", "api_key_value"):
            self.assertNotIn(key, redacted)
        self.assertNotIn("client_secret", redacted)
        self.assertEqual(redacted["bank_iban"], "****2957")
        self.assertEqual(redacted["safe_field"], "safe")

    def test_redaction_masks_only_iban_fields(self):
        self.assertEqual(
            redact_metadata({
                "iban": "CH12", "bank_iban": "CH123456789",
                "recipient_iban": ["CH987654321"],
                "iban_note": "use for refunds", "iban_holder": "Alice",
                "iban_history": ["active", "cancelled"], "liban_notes": "safe",
            }),
            {
                "iban": "****", "bank_iban": "****6789", "recipient_iban": ["****4321"],
                "iban_note": "use for refunds", "iban_holder": "Alice",
                "iban_history": ["active", "cancelled"], "liban_notes": "safe",
            },
        )

    def test_redaction_caps_stringified_values_before_persistence(self):
        class LongValue:
            def __str__(self):
                return "x" * 1000

        event = record_audit_event(
            action_category=AuditActionCategory.SYSTEM, action_type="system.test",
            target_type="test", summary="String conversion",
            metadata={"custom": LongValue(), "decimal": Decimal("1" * 1000)},
        )
        event.refresh_from_db()
        for value in event.metadata_json.values():
            self.assertEqual(len(value), 500)
            self.assertTrue(value.endswith("..."))

    def test_redaction_preserves_empty_diff_sides(self):
        for before, after, expected in (
            ({"mode": "on"}, {}, {"before": {"mode": "on"}, "after": {}}),
            ({}, {"mode": "on"}, {"before": {}, "after": {"mode": "on"}}),
            ({"token": "old"}, {"token": "new"}, {"before": {}, "after": {}}),
        ):
            with self.subTest(before=before, after=after):
                event = record_audit_event(
                    action_category=AuditActionCategory.SYSTEM, action_type="system.test",
                    target_type="test", summary="Empty diff sides",
                    changes=build_diff({"settings": before}, {"settings": after}, ["settings"]),
                )
                event.refresh_from_db()
                self.assertEqual(event.changes_json, {"settings": expected})
        self.assertEqual(redact_metadata({"settings": {}, "secrets": {"token": "secret"}}), {})

    def test_redaction_truncates_large_strings_and_caps_collections(self):
        redacted = redact_metadata(
            {
                "notes": "x" * 800,
                "items": list(range(25)),
                "nested": {"value": "y" * 900},
                "deep_list": [{"value": "z" * 700} for _ in range(22)],
            }
        )

        self.assertEqual(len(redacted["notes"]), 500)
        self.assertTrue(redacted["notes"].endswith("..."))
        self.assertEqual(len(redacted["items"]), 21)
        self.assertEqual(redacted["items"][-1], "...(+5 more)")
        self.assertEqual(len(redacted["nested"]["value"]), 500)
        self.assertTrue(redacted["nested"]["value"].endswith("..."))
        self.assertEqual(len(redacted["deep_list"]), 21)
        self.assertEqual(redacted["deep_list"][-1], "...(+2 more)")

    def test_redaction_recurses_through_lists_tuples_and_diffs(self):
        payload = {"items": ([{"password": "secret", "bank_iban": "CH123456789", "safe": "value"}],)}
        expected = {"items": [[{"bank_iban": "****6789", "safe": "value"}]]}
        self.assertEqual(redact_metadata(payload), expected)
        event = record_audit_event(
            action_category=AuditActionCategory.SYSTEM,
            action_type="system.test",
            target_type="test",
            summary="Nested redaction",
            metadata=payload,
            changes=build_diff({"data": payload}, {"data": None}, ["data"]),
        )
        event.refresh_from_db()
        self.assertEqual(event.metadata_json, expected)
        self.assertEqual(event.changes_json, {"data": {"before": expected, "after": None}})

    def test_redaction_caps_root_and_nested_dictionaries(self):
        oversized = {str(i): "safe" for i in range(55)}
        expected = {str(i): "safe" for i in range(50)} | {"...": "+5 more"}
        self.assertEqual(redact_metadata(oversized), expected)
        self.assertEqual(redact_metadata({"items": [oversized]}), {"items": [expected]})
        payload = {"items": [oversized] * 25}
        redacted = redact_metadata(payload)
        event = record_audit_event(
            action_category=AuditActionCategory.SYSTEM, action_type="system.test",
            target_type="test", summary="Truncated diff",
            changes=build_diff({}, {"data": payload}, ["data"]),
        )
        event.refresh_from_db()
        self.assertEqual(event.changes_json["data"]["after"], redacted)

    def test_redaction_recomputes_marker_shaped_user_values(self):
        payload = {**{str(i): "safe" for i in range(55)}, "...": "+attacker more"}
        self.assertEqual(redact_metadata(payload)["..."], "+6 more")
        self.assertEqual(
            redact_metadata({"items": [*range(21), "...(+999 more)"]})["items"],
            [*range(20), "...(+2 more)"],
        )

    def test_scalar_iban_diffs_are_masked_before_persistence(self):
        event = record_audit_event(
            action_category=AuditActionCategory.SYSTEM, action_type="system.test",
            target_type="test", summary="IBAN diff",
            changes=build_diff({"bank_iban": "CH123456789"}, {"bank_iban": "CH987654321"}, ["bank_iban"]),
        )
        event.refresh_from_db()
        self.assertEqual(event.changes_json, {"bank_iban": {"before": "****6789", "after": "****4321"}})

    def test_api_key_attribution_survives_oversized_and_spoofed_metadata(self):
        key, raw_key = create_api_key(self.admin, name="trusted key")
        request = APIRequestFactory().get("/api/v1/audit/events/", HTTP_AUTHORIZATION=f"Api-Key {raw_key}")
        request.resolver_match = resolve(request.path)
        request.user, request.auth = ApiKeyAuthentication().authenticate(request)
        event = record_audit_event(
            action_category=AuditActionCategory.SYSTEM, action_type="system.test",
            target_type="test", summary="Key attribution", request=request,
            metadata={**{str(i): "safe" for i in range(50)}, "api_key_id": "spoof", "api_key_name": "spoof"},
        )
        event.refresh_from_db()
        self.assertEqual(event.metadata_json["api_key_id"], str(key.pk))
        self.assertEqual(event.metadata_json["api_key_name"], "trusted key")
        self.assertEqual(len(event.metadata_json), 51)
        self.assertEqual(event.metadata_json["..."], "+2 more")

    def test_record_audit_event_truncates_reason(self):
        event = record_audit_event(
            action_category=AuditActionCategory.SYSTEM,
            action_type="system.long_reason",
            target_type="system.Event",
            summary="Long reason event",
            reason="r" * 2500,
            user=self.admin,
            zev=self.zev,
        )

        self.assertEqual(len(event.reason), 2000)
        self.assertTrue(event.reason.endswith("..."))

    def test_build_diff_uses_allowed_fields_only(self):
        diff = build_diff(
            before={"status": "draft", "total": "10.00", "secret": "nope"},
            after={"status": "approved", "total": "10.00", "secret": "changed"},
            allowed_fields=["status", "total"],
        )
        self.assertEqual(diff, {"status": {"before": "draft", "after": "approved"}})

    def test_build_diff_compares_untruncated_values(self):
        before, after = "x" * 500 + "before", "x" * 500 + "after"
        self.assertEqual(
            build_diff({"notes": before}, {"notes": after}, ["notes"]),
            {"notes": {"before": before, "after": after}},
        )

    def test_build_instance_snapshot_reads_fks_without_extra_queries(self):
        participant = Participant.objects.create(
            zev=self.zev,
            first_name="Snap",
            last_name="Shot",
            email="snap@example.com",
            valid_from=timezone.localdate(),
        )
        # Re-fetch so the FK is not already cached on the instance.
        participant = Participant.objects.get(pk=participant.pk)

        with self.assertNumQueries(0):
            snapshot = build_instance_snapshot(participant, ["zev", "first_name", "user"])

        self.assertEqual(snapshot["zev"], str(self.zev.pk))
        self.assertEqual(snapshot["first_name"], "Snap")
        self.assertIsNone(snapshot["user"])

    def test_audited_update_mixin_tracks_every_writable_serializer_field(self):
        """The mixin derives tracked fields from the serializer rather than a
        hand-written list, so a newly added writable field is audited without
        anyone remembering to update a second list."""
        from zev.views import ParticipantViewSet

        view = ParticipantViewSet()
        serializer = ParticipantSerializer()
        tracked = set(view.get_audit_tracked_fields(serializer))
        writable = {name for name, field in serializer.fields.items() if not field.read_only}

        self.assertEqual(tracked, writable)
        # Spot-check the fields whose absence caused the original bug.
        self.assertTrue({"phone", "address_line1", "postal_code", "city", "notes"} <= tracked)

    def test_infer_zev_resolves_nested_objects(self):
        participant = Participant.objects.create(
            zev=self.zev,
            first_name="Jane",
            last_name="Doe",
            email="jane@example.com",
            valid_from=timezone.localdate(),
        )
        metering_point = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH1230000000000000000000000000001",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        assignment = MeteringPointAssignment.objects.create(
            metering_point=metering_point,
            participant=participant,
            valid_from=timezone.localdate(),
        )
        invoice = Invoice.objects.create(
            invoice_number="AUD-00001",
            zev=self.zev,
            participant=participant,
            period_start=timezone.localdate(),
            period_end=timezone.localdate(),
            status=InvoiceStatus.DRAFT,
        )

        self.assertEqual(infer_zev(self.zev), self.zev)
        self.assertEqual(infer_zev(participant), self.zev)
        self.assertEqual(infer_zev(assignment), self.zev)
        self.assertEqual(infer_zev(invoice), self.zev)


class AuditEventApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_user("audit_admin_api", UserRole.ADMIN)
        self.owner1 = make_user("audit_owner1_api", UserRole.USER)
        self.owner2 = make_user("audit_owner2_api", UserRole.USER)
        self.participant_user = make_user("audit_participant_api", UserRole.USER)

        self.zev1 = create_managed_zev(name="ZEV 1", owner=self.owner1)
        self.zev2 = create_managed_zev(name="ZEV 2", owner=self.owner2)

        self.owner1_event = AuditEvent.objects.create(
            zev=self.zev1,
            action_category=AuditActionCategory.INVOICE,
            action_type="invoice.approve",
            target_type="invoices.Invoice",
            target_id="inv-1",
            summary="Owner1 invoice approved",
            status=AuditEventStatus.SUCCESS,
        )
        self.owner2_event = AuditEvent.objects.create(
            zev=self.zev2,
            action_category=AuditActionCategory.GOVERNANCE,
            action_type="zev.update",
            target_type="zev.Zev",
            target_id="zev-2",
            summary="Owner2 zev updated",
            status=AuditEventStatus.FAILED,
        )
        self.global_event = AuditEvent.objects.create(
            zev=None,
            action_category=AuditActionCategory.AUTH,
            action_type="auth.login",
            target_type="accounts.User",
            target_id=str(self.admin.id),
            summary="Admin login",
            status=AuditEventStatus.SUCCESS,
            changes_json={"status": {"before": "x", "after": "y"}},
            metadata_json={"safe": "value"},
        )

    def test_admin_can_list_all_audit_events(self):
        auth(self.client, self.admin)
        response = self.client.get("/api/v1/audit/events/")
        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.data["results"]}
        self.assertIn(str(self.owner1_event.id), ids)
        self.assertIn(str(self.owner2_event.id), ids)
        self.assertIn(str(self.global_event.id), ids)

    def test_zev_owner_sees_only_owned_zev_events(self):
        auth(self.client, self.owner1)
        response = self.client.get("/api/v1/audit/events/")
        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.data["results"]}
        self.assertIn(str(self.owner1_event.id), ids)
        self.assertNotIn(str(self.owner2_event.id), ids)
        self.assertNotIn(str(self.global_event.id), ids)

    def test_owner_cannot_access_global_event_with_null_zev(self):
        auth(self.client, self.owner1)
        response = self.client.get(f"/api/v1/audit/events/{self.global_event.id}/")
        self.assertEqual(response.status_code, 404)

    def test_participant_cannot_access_audit_api(self):
        auth(self.client, self.participant_user)
        response = self.client.get("/api/v1/audit/events/")
        self.assertEqual(response.status_code, 403)

    def test_list_filters_by_category_status_and_date_range(self):
        AuditEvent.objects.filter(pk=self.owner1_event.pk).update(created_at=timezone.now() - timedelta(days=2))
        auth(self.client, self.admin)
        response = self.client.get(
            "/api/v1/audit/events/",
            {
                "action_category": AuditActionCategory.GOVERNANCE,
                "status": AuditEventStatus.FAILED,
                "date_from": timezone.localdate().isoformat(),
            },
        )
        self.assertEqual(response.status_code, 200)
        results = response.data["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], str(self.owner2_event.id))

    def test_list_filters_by_zev_and_actor_user(self):
        AuditEvent.objects.filter(pk=self.owner1_event.pk).update(actor_user=self.participant_user)
        AuditEvent.objects.filter(pk=self.owner2_event.pk).update(actor_user=self.participant_user)
        AuditEvent.objects.filter(pk=self.global_event.pk).update(actor_user=self.admin)
        auth(self.client, self.admin)

        response = self.client.get("/api/v1/audit/events/", {"zev": str(self.zev1.id)})
        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.data["results"]}
        self.assertIn(str(self.owner1_event.id), ids)
        self.assertNotIn(str(self.owner2_event.id), ids)
        self.assertNotIn(str(self.global_event.id), ids)

        response = self.client.get("/api/v1/audit/events/", {"actor_user": self.participant_user.id})
        self.assertEqual(response.status_code, 200)
        ids = {item["id"] for item in response.data["results"]}
        self.assertIn(str(self.owner1_event.id), ids)
        self.assertIn(str(self.owner2_event.id), ids)
        self.assertNotIn(str(self.global_event.id), ids)

        response = self.client.get(
            "/api/v1/audit/events/",
            {"zev": str(self.zev1.id), "actor_user": self.participant_user.id},
        )
        self.assertEqual(response.status_code, 200)
        results = response.data["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], str(self.owner1_event.id))

    def test_search_preserves_scope_and_combined_filters(self):
        AuditEvent.objects.all().update(summary="Same matching text", actor_user=self.owner2)
        auth(self.client, self.owner1)
        for extra in ({}, {"zev": str(self.zev1.id), "actor_user": self.owner2.id, "target_id": "inv-1"}):
            with self.subTest(filters=extra):
                response = self.client.get("/api/v1/audit/events/", {"q": "matching", **extra})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["count"], 1)
                self.assertEqual([row["id"] for row in response.data["results"]], [str(self.owner1_event.id)])
        for extra in ({"zev": str(self.zev2.id)}, {"target_id": "zev-2"}, {"actor_user": self.admin.id}):
            with self.subTest(filters=extra):
                response = self.client.get("/api/v1/audit/events/", {"q": "matching", **extra})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["count"], 0)
                self.assertEqual(response.data["results"], [])
        auth(self.client, self.admin)
        response = self.client.get("/api/v1/audit/events/", {"q": "matching"})
        self.assertEqual(response.data["count"], 3)

    def test_search_matches_each_field(self):
        auth(self.client, self.owner1)
        for field in ("summary", "target_display", "action_type"):
            with self.subTest(field=field):
                AuditEvent.objects.filter(pk=self.owner1_event.pk).update(
                    **{"summary": "ordinary", "target_display": "", "action_type": "test", field: "MiXeD text"}
                )
                response = self.client.get("/api/v1/audit/events/", {"q": "mixed"})
                self.assertEqual(response.data["count"], 1)

    def test_search_treats_input_literally(self):
        auth(self.client, self.owner1)
        for query in ("%", "_", "\\", "' OR 1=1 --", "<script>alert(1)</script>", "é😀"):
            with self.subTest(query=query):
                AuditEvent.objects.filter(pk=self.owner1_event.pk).update(summary=f"Literal {query}")
                response = self.client.get("/api/v1/audit/events/", {"q": query})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["count"], 1)
                AuditEvent.objects.filter(pk=self.owner1_event.pk).update(summary="ordinary")
                response = self.client.get("/api/v1/audit/events/", {"q": query})
                self.assertEqual(response.data["count"], 0)

    def test_search_ignores_blank_and_trims_input(self):
        auth(self.client, self.owner1)
        unfiltered = self.client.get("/api/v1/audit/events/").data
        for query in ("", "   "):
            with self.subTest(query=query):
                self.assertEqual(self.client.get("/api/v1/audit/events/", {"q": query}).data, unfiltered)
        response = self.client.get("/api/v1/audit/events/", {"q": "  invoice  "})
        self.assertEqual([row["id"] for row in response.data["results"]], [str(self.owner1_event.pk)])

    def test_search_validates_text_length_boundaries(self):
        auth(self.client, self.owner1)
        for length, status in ((50, 200), (51, 400)):
            self.assertEqual(self.client.get("/api/v1/audit/events/", {"q": "😀" * length}).status_code, status)
        for field, limit in (("q", 50), ("action_type", 80), ("target_type", 120), ("target_id", 64)):
            with self.subTest(field=field):
                response = self.client.get("/api/v1/audit/events/", {field: "x" * limit})
                self.assertEqual(response.status_code, 200)
                response = self.client.get("/api/v1/audit/events/", {field: "x" * (limit + 1)})
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)

    def test_search_rejects_invalid_structured_filters(self):
        auth(self.client, self.owner1)
        for filters in ({"zev": "bad"}, {"date_from": "bad"}, {"status": "bad"},
                        {"action_category": "bad"}, {"date_from": "2026-02-02", "date_to": "2026-01-01"}):
            with self.subTest(filters=filters):
                self.assertEqual(self.client.get("/api/v1/audit/events/", {"q": "x", **filters}).status_code, 400)

    def test_search_allows_viewer_and_party_derived_manager(self):
        today = timezone.localdate()
        viewer = make_user("audit_viewer", UserRole.USER)
        ZevAccessGrant.objects.create(zev=self.zev1, user=viewer, role=ZevAccessRole.VIEWER, valid_from=today)
        party_manager = make_user("audit_party_manager", UserRole.USER)
        party = Party.objects.create(zev=self.zev1, user=party_manager, last_name="Issuer")
        ZevPartyRole.objects.create(zev=self.zev1, party=party, role=PartyRole.ISSUER, valid_from=today)
        for user in (viewer, party_manager):
            with self.subTest(user=user.username):
                auth(self.client, user)
                response = self.client.get("/api/v1/audit/events/", {"q": "invoice"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["count"], 1)
                self.assertEqual(response.data["results"][0]["id"], str(self.owner1_event.id))

    def test_search_denies_missing_expired_future_and_revoked_access(self):
        auth(self.client, self.participant_user)
        self.assertEqual(self.client.get("/api/v1/audit/events/", {"q": "invoice"}).status_code, 403)
        grants = ZevAccessGrant.objects.filter(user=self.owner1)
        today = timezone.localdate()
        for dates in (
            {"valid_from": today - timedelta(days=2), "valid_to": today - timedelta(days=1)},
            {"valid_from": today + timedelta(days=1), "valid_to": None},
        ):
            with self.subTest(dates=dates):
                grants.update(**dates)
                auth(self.client, self.owner1)
                self.assertEqual(self.client.get("/api/v1/audit/events/", {"q": "invoice"}).status_code, 403)
        grants.delete()
        auth(self.client, self.owner1)
        self.assertEqual(self.client.get("/api/v1/audit/events/", {"q": "invoice"}).status_code, 403)

    def test_filter_options_admin_sees_all_zevs_and_actors(self):
        AuditEvent.objects.filter(pk=self.owner1_event.pk).update(actor_user=self.owner1)
        AuditEvent.objects.filter(pk=self.owner2_event.pk).update(actor_user=self.owner2)
        AuditEvent.objects.filter(pk=self.global_event.pk).update(actor_user=self.admin)
        auth(self.client, self.admin)

        response = self.client.get("/api/v1/audit/events/filter-options/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {zev["id"] for zev in response.data["zevs"]},
            {str(self.zev1.id), str(self.zev2.id)},
        )
        self.assertEqual(
            {actor["username"] for actor in response.data["actors"]},
            {"audit_owner1_api", "audit_owner2_api", "audit_admin_api"},
        )
        self.assertEqual(
            set(response.data.keys()),
            {"zevs", "actors"},
        )

    def test_filter_options_owner_scoped_to_own_community(self):
        AuditEvent.objects.filter(pk=self.owner1_event.pk).update(actor_user=self.participant_user)
        AuditEvent.objects.filter(pk=self.owner2_event.pk).update(actor_user=self.owner2)
        AuditEvent.objects.filter(pk=self.global_event.pk).update(actor_user=self.admin)
        AuditEvent.objects.create(
            zev=self.zev1,
            actor_user=self.admin,
            action_category=AuditActionCategory.GOVERNANCE,
            action_type="zev.update",
            target_type="zev.Zev",
            target_id="zev-1",
            summary="Admin updated owner1 zev",
            status=AuditEventStatus.SUCCESS,
        )
        AuditEvent.objects.create(
            zev=self.zev1,
            actor_user=self.owner1,
            action_category=AuditActionCategory.GOVERNANCE,
            action_type="zev.update",
            target_type="zev.Zev",
            target_id="zev-1",
            summary="Owner1 updated own zev",
            status=AuditEventStatus.SUCCESS,
        )
        auth(self.client, self.owner1)

        response = self.client.get("/api/v1/audit/events/filter-options/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual({zev["id"] for zev in response.data["zevs"]}, {str(self.zev1.id)})
        self.assertEqual(
            {actor["username"] for actor in response.data["actors"]},
            {"audit_participant_api", "audit_admin_api", "audit_owner1_api"},
        )

    def test_filter_options_participant_forbidden(self):
        auth(self.client, self.participant_user)
        response = self.client.get("/api/v1/audit/events/filter-options/")
        self.assertEqual(response.status_code, 403)

    def test_detail_returns_full_diff_and_metadata(self):
        auth(self.client, self.admin)
        response = self.client.get(f"/api/v1/audit/events/{self.global_event.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("changes_json", response.data)
        self.assertIn("metadata_json", response.data)
        self.assertEqual(response.data["metadata_json"]["safe"], "value")


@mock.patch.object(AuditListThrottle, "THROTTLE_RATES", {"audit_list": "2/minute"})
class AuditEventThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.client = APIClient()
        self.owner = make_user("audit_throttle_owner", UserRole.USER)
        self.zev = create_managed_zev(name="Throttled ZEV", owner=self.owner)
        self.client.cookies["openzev_access"] = make_jwt_for_user(self.owner)["access"]

    def test_cookie_search_budget_is_shared_across_filters_and_api_keys(self):
        self.assertEqual(self.client.get("/api/v1/audit/events/", {"q": "first"}).status_code, 200)
        _, key = create_api_key(self.owner)
        key_client = APIClient()
        key_client.credentials(HTTP_AUTHORIZATION=f"Api-Key {key}")
        self.assertEqual(key_client.get("/api/v1/audit/events/", {"zev": str(self.zev.id)}).status_code, 200)
        self.assertEqual(self.client.get("/api/v1/audit/events/", {"q": "different"}).status_code, 429)
        _, other_key = create_api_key(self.owner, name="other")
        key_client.credentials(HTTP_AUTHORIZATION=f"Api-Key {other_key}")
        self.assertEqual(key_client.get("/api/v1/audit/events/").status_code, 429)

    def test_users_have_separate_budgets_and_detail_options_are_unaffected(self):
        for _ in range(2):
            self.assertEqual(self.client.get("/api/v1/audit/events/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/audit/events/").status_code, 429)
        self.assertEqual(self.client.get("/api/v1/audit/events/filter-options/").status_code, 200)
        event = AuditEvent.objects.create(
            zev=self.zev, action_category=AuditActionCategory.SYSTEM,
            action_type="system.test", target_type="test", summary="test",
        )
        self.assertEqual(self.client.get(f"/api/v1/audit/events/{event.pk}/").status_code, 200)
        other = make_user("audit_throttle_other", UserRole.USER)
        create_managed_zev(name="Other throttled ZEV", owner=other)
        auth(self.client, other)
        self.assertEqual(self.client.get("/api/v1/audit/events/").status_code, 200)

    @mock.patch.object(ApiKeyRateThrottle, "THROTTLE_RATES", {"api_key": "1/minute"})
    def test_existing_api_key_budget_still_applies(self):
        _, key = create_api_key(self.owner)
        key_client = APIClient()
        key_client.credentials(HTTP_AUTHORIZATION=f"Api-Key {key}")
        self.assertEqual(key_client.get("/api/v1/audit/events/").status_code, 200)
        self.assertEqual(key_client.get("/api/v1/audit/events/").status_code, 429)
        self.assertEqual(self.client.get("/api/v1/audit/events/").status_code, 429)

    @mock.patch.object(AuditListThrottle, "timer", return_value=0)
    def test_budget_recovers_after_retry_after(self, timer):
        for _ in range(2):
            self.assertEqual(self.client.get("/api/v1/audit/events/").status_code, 200)
        response = self.client.get("/api/v1/audit/events/")
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response["Retry-After"], "60")
        timer.return_value = 61
        self.assertEqual(self.client.get("/api/v1/audit/events/").status_code, 200)


class AuditInstrumentationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_user("phase2_admin", UserRole.ADMIN)
        self.owner = make_user("phase2_owner", UserRole.USER)
        self.participant_user = make_user("phase2_participant", UserRole.USER)
        self.zev = create_managed_zev(name="Phase2 ZEV", owner=self.owner)
        self.participant = Participant.objects.create(
            zev=self.zev,
            user=self.participant_user,
            first_name="Pat",
            last_name="User",
            email="pat@example.com",
            valid_from=timezone.localdate(),
        )
        self.invoice = Invoice.objects.create(
            invoice_number="P2-0001",
            zev=self.zev,
            participant=self.participant,
            period_start=timezone.localdate(),
            period_end=timezone.localdate(),
            status=InvoiceStatus.DRAFT,
        )

    def test_invoice_approve_emits_audit_event(self):
        auth(self.client, self.owner)
        response = self.client.post(f"/api/v1/invoices/invoices/{self.invoice.id}/approve/")

        self.assertEqual(response.status_code, 200)
        event = AuditEvent.objects.filter(action_type="invoice.approve", target_id=str(self.invoice.id)).latest("created_at")
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)
        self.assertEqual(event.action_category, AuditActionCategory.INVOICE)
        self.assertEqual(event.zev_id, self.zev.id)

    def test_feature_flag_update_emits_audit_event(self):
        flag = FeatureFlag.objects.create(name="phase2_test_flag", enabled=False)
        auth(self.client, self.admin)

        response = self.client.patch(
            f"/api/v1/auth/feature-flags/{flag.id}/",
            {"enabled": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        event = AuditEvent.objects.filter(action_type="feature_flag.update", target_id=str(flag.id)).latest("created_at")
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)
        self.assertEqual(event.action_category, AuditActionCategory.GOVERNANCE)
        self.assertEqual(event.changes_json.get("enabled", {}).get("before"), False)
        self.assertEqual(event.changes_json.get("enabled", {}).get("after"), True)

    def test_impersonation_denied_for_non_admin_emits_audit_event(self):
        auth(self.client, self.owner)
        response = self.client.post(f"/api/v1/auth/users/{self.participant_user.id}/impersonate/")

        self.assertEqual(response.status_code, 403)
        event = AuditEvent.objects.filter(
            action_type="impersonation.issue_token",
            target_id=str(self.participant_user.id),
        ).latest("created_at")
        self.assertEqual(event.status, AuditEventStatus.DENIED)
        self.assertEqual(event.action_category, AuditActionCategory.AUTH)


class AuditPhase3InstrumentationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_user("phase3_admin", UserRole.ADMIN)
        self.owner = make_user("phase3_owner", UserRole.USER)
        self.participant_user = make_user("phase3_participant", UserRole.USER)
        self.guest_user = make_user("phase3_guest", UserRole.USER)
        self.zev = create_managed_zev(name="Phase3 ZEV", owner=self.owner)
        self.participant = Participant.objects.create(
            zev=self.zev,
            user=self.participant_user,
            first_name="Phase",
            last_name="Three",
            email="phase3@example.com",
            valid_from=timezone.localdate(),
        )
        self.metering_point = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH9990000000000000000000000000001",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        MeteringPointAssignment.objects.create(
            metering_point=self.metering_point,
            participant=self.participant,
            valid_from=timezone.localdate(),
        )

    def test_participant_link_account_emits_audit_event(self):
        auth(self.client, self.admin)
        response = self.client.post(
            f"/api/v1/zev/participants/{self.participant.id}/link-account/",
            {"user_id": self.guest_user.id},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        event = AuditEvent.objects.filter(
            action_type="participant.link_account",
            target_id=str(self.participant.id),
        ).latest("created_at")
        self.assertEqual(event.action_category, AuditActionCategory.PARTICIPANT)
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)

    @mock.patch("zev.tasks.warm_building_geocode_cache_task.delay")
    def test_participant_update_emits_audit_event_with_field_changes(self, mock_geocode_delay):
        auth(self.client, self.admin)
        response = self.client.patch(
            f"/api/v1/zev/participants/{self.participant.id}/",
            {
                "first_name": "Updated",
                "phone": "+41 79 123 45 67",
                "address_line1": "Musterstrasse 1",
                "postal_code": "8000",
                "city": "Zurich",
                "notes": "Prefers e-mail contact.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        event = AuditEvent.objects.filter(
            action_type="participant.update",
            target_id=str(self.participant.id),
        ).latest("created_at")
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)
        self.assertEqual(event.changes_json.get("first_name", {}).get("before"), "Phase")
        self.assertEqual(event.changes_json.get("first_name", {}).get("after"), "Updated")
        self.assertEqual(event.changes_json.get("phone", {}).get("after"), "+41 79 123 45 67")
        self.assertEqual(event.changes_json.get("address_line1", {}).get("after"), "Musterstrasse 1")
        self.assertEqual(event.changes_json.get("postal_code", {}).get("after"), "8000")
        self.assertEqual(event.changes_json.get("city", {}).get("after"), "Zurich")
        self.assertEqual(event.changes_json.get("notes", {}).get("after"), "Prefers e-mail contact.")
        self.assertNotIn("last_name", event.changes_json)

    def test_metering_delete_readings_emits_audit_event(self):
        MeterReading.objects.create(
            metering_point=self.metering_point,
            timestamp=timezone.now(),
            energy_kwh="1.2300",
            direction="in",
            resolution="hourly",
            import_source="manual",
        )
        auth(self.client, self.admin)
        response = self.client.post(
            f"/api/v1/zev/metering-points/{self.metering_point.id}/delete-readings/",
            {"delete_all": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        event = AuditEvent.objects.filter(
            action_type="metering_point.delete_readings",
            target_id=str(self.metering_point.id),
        ).latest("created_at")
        self.assertEqual(event.action_category, AuditActionCategory.METERING)
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)

    def test_tariff_create_emits_audit_event(self):
        auth(self.client, self.owner)
        response = self.client.post(
            "/api/v1/tariffs/tariffs/",
            {
                "zev": str(self.zev.id),
                "name": "Phase3 Tariff",
                "category": TariffCategory.ENERGY,
                "billing_mode": BillingMode.ENERGY,
                "energy_type": "local",
                "valid_from": timezone.localdate().isoformat(),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        tariff_id = response.data["id"]
        event = AuditEvent.objects.filter(action_type="tariff.create", target_id=str(tariff_id)).latest("created_at")
        self.assertEqual(event.action_category, AuditActionCategory.TARIFF)
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)

    def test_import_without_file_emits_failed_audit_event(self):
        auth(self.client, self.owner)
        response = self.client.post("/api/v1/metering/import/csv/", {}, format="multipart")
        self.assertEqual(response.status_code, 400)
        event = AuditEvent.objects.filter(action_type="import.upload").latest("created_at")
        self.assertEqual(event.action_category, AuditActionCategory.IMPORT)
        self.assertEqual(event.status, AuditEventStatus.FAILED)

    def test_metering_point_update_emits_audit_event_with_field_changes(self):
        auth(self.client, self.admin)
        response = self.client.patch(
            f"/api/v1/zev/metering-points/{self.metering_point.id}/",
            {"meter_id": "CH9990000000000000000000000000099", "location_description": "Basement"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        event = AuditEvent.objects.filter(
            action_type="metering_point.update",
            target_id=str(self.metering_point.id),
        ).latest("created_at")
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)
        self.assertEqual(event.changes_json.get("meter_id", {}).get("after"), "CH9990000000000000000000000000099")
        self.assertEqual(event.changes_json.get("location_description", {}).get("after"), "Basement")

    def test_metering_assignment_update_emits_audit_event_with_field_changes(self):
        other_metering_point = MeteringPoint.objects.create(
            zev=self.zev,
            meter_id="CH9990000000000000000000000000002",
            meter_type=MeteringPointType.CONSUMPTION,
        )
        assignment = MeteringPointAssignment.objects.get(
            metering_point=self.metering_point,
            participant=self.participant,
        )
        auth(self.client, self.admin)
        response = self.client.patch(
            f"/api/v1/zev/metering-point-assignments/{assignment.id}/",
            {"metering_point": str(other_metering_point.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        event = AuditEvent.objects.filter(
            action_type="metering_assignment.update",
            target_id=str(assignment.id),
        ).latest("created_at")
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)
        self.assertEqual(event.changes_json.get("metering_point", {}).get("after"), str(other_metering_point.id))

    def test_tariff_update_emits_audit_event_with_field_changes(self):
        tariff = Tariff.objects.create(
            zev=self.zev,
            name="Phase3 Grid Tariff",
            category=TariffCategory.ENERGY,
            billing_mode=BillingMode.ENERGY,
            energy_type="grid",
            valid_from=timezone.localdate(),
        )
        auth(self.client, self.owner)
        response = self.client.patch(
            f"/api/v1/tariffs/tariffs/{tariff.id}/",
            {"name": "Updated Grid Tariff", "notes": "Renegotiated rate."},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        event = AuditEvent.objects.filter(
            action_type="tariff.update",
            target_id=str(tariff.id),
        ).latest("created_at")
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)
        self.assertEqual(event.changes_json.get("name", {}).get("after"), "Updated Grid Tariff")
        self.assertEqual(event.changes_json.get("notes", {}).get("after"), "Renegotiated rate.")

    def test_tariff_period_update_emits_audit_event_with_field_changes(self):
        tariff = Tariff.objects.create(
            zev=self.zev,
            name="Phase3 Flat Tariff",
            category=TariffCategory.ENERGY,
            billing_mode=BillingMode.ENERGY,
            energy_type="local",
            valid_from=timezone.localdate(),
        )
        period = tariff.periods.create(period_type="flat", price_chf_per_kwh="0.20000")
        auth(self.client, self.owner)
        response = self.client.patch(
            f"/api/v1/tariffs/periods/{period.id}/",
            {"price_chf_per_kwh": "0.25000"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        event = AuditEvent.objects.filter(
            action_type="tariff_period.update",
            target_id=str(period.id),
        ).latest("created_at")
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)
        self.assertEqual(event.changes_json.get("price_chf_per_kwh", {}).get("after"), "0.25000")

    def test_user_update_emits_audit_event_with_field_changes(self):
        auth(self.client, self.admin)
        response = self.client.patch(
            f"/api/v1/auth/users/{self.participant_user.id}/",
            {"first_name": "Updated", "last_name": "Name", "must_change_password": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        event = AuditEvent.objects.filter(
            action_type="user.update",
            target_id=str(self.participant_user.id),
        ).latest("created_at")
        self.assertEqual(event.status, AuditEventStatus.SUCCESS)
        self.assertEqual(event.changes_json.get("first_name", {}).get("after"), "Updated")
        self.assertEqual(event.changes_json.get("last_name", {}).get("after"), "Name")
        self.assertEqual(event.changes_json.get("must_change_password", {}).get("after"), True)


class ImpersonationAttributionTests(TestCase):
    """Attribute impersonated actions to the account and the admin."""

    class _Request:
        """The bits of a DRF request ``record_audit_event`` reads."""

        def __init__(self, auth, user=None):
            from accounts.jwt_utils import impersonator_of

            self.impersonator_id = impersonator_of(auth)
            self.user = user

    def _record(self, request):
        return record_audit_event(
            request=request,
            action_category=AuditActionCategory.AUTH,
            action_type="impersonation.probe",
            target_type="accounts.User",
            summary="Probe.",
        )

    def _token(self, user, **kwargs):
        from rest_framework_simplejwt.tokens import AccessToken

        from accounts.jwt_utils import make_jwt_for_user

        return AccessToken(make_jwt_for_user(user, **kwargs)["access"])

    def test_an_event_written_while_impersonating_names_the_admin(self):
        admin = make_user("attr_admin")
        target = make_user("attr_target")

        event = self._record(self._Request(self._token(target, impersonated_by=admin.pk), user=target))

        self.assertEqual(event.metadata_json["impersonated_by"], admin.pk)
        # The actor is still the impersonated account; the marker is the only
        # record of who was driving.
        self.assertEqual(event.actor_user_id, target.pk)

    def test_an_ordinary_session_records_no_impersonator(self):
        event = self._record(self._Request(self._token(make_user("attr_plain"))))

        self.assertNotIn("impersonated_by", event.metadata_json)

    def test_an_api_key_request_is_not_an_impersonation(self):
        from accounts.models import ApiKey

        key = ApiKey(user=make_user("attr_key"), name="probe", prefix="attrkey", hashed_key="x" * 64)

        event = self._record(self._Request(key))

        self.assertNotIn("impersonated_by", event.metadata_json)
