from django.test import SimpleTestCase, TestCase
from django.core import mail
from django.core.cache import cache
from django.test.utils import override_settings
from rest_framework.test import APIClient
from urllib.parse import parse_qs, urlparse
import hashlib
import os
from unittest import mock

from .models import (
	AppSettings,
	FeatureFlag,
	EmailVerificationToken,
	OAuthExchangeCode,
	OAuthProvider,
	OAuthState,
	User,
	UserRole,
	VatRate,
)
from audit.models import AuditActionCategory, AuditEvent, AuditEventStatus
from invoices.models import EmailTemplate, Invoice, InvoiceStatus
from zev.models import BillingInterval, MeteringPoint, MeteringPointAssignment, MeteringPointType, Participant
from datetime import date, timedelta
from django.utils import timezone

from .tasks import cleanup_expired_oauth_tokens
from testing.helpers import clear_vat_rates, create_managed_zev


class UserModelTests(TestCase):
	def test_user_role_helpers(self):
		admin = User.objects.create_user(username="admin", password="x", role=UserRole.ADMIN)
		owner = User.objects.create_user(username="owner", password="x", role=UserRole.USER)
		participant = User.objects.create_user(
			username="participant", password="x", role=UserRole.USER
		)

		self.assertTrue(admin.is_admin)
		# Managing a ZEV is a per-ZEV grant now, not a property of the role (#761).
		self.assertFalse(owner.is_admin)
		self.assertFalse(hasattr(owner, "is_zev_owner"))
		self.assertFalse(participant.is_admin)

	def test_create_superuser_sets_admin_role(self):
		superuser = User.objects.create_superuser(
			username="root",
			email="root@example.com",
			password="super-secret",
		)

		self.assertEqual(superuser.role, UserRole.ADMIN)
		self.assertTrue(superuser.is_superuser)
		self.assertTrue(superuser.is_staff)

	def test_create_superuser_rejects_non_admin_role(self):
		with self.assertRaisesMessage(ValueError, "Superuser must have role='admin'."):
			User.objects.create_superuser(
				username="invalid-root",
				email="invalid@example.com",
				password="super-secret",
				role=UserRole.USER,
			)



def _cookie_auth(client, username, password="pass1234"):
	"""Authenticate the test client as ``username`` via a Bearer token."""
	from .models import User as _User
	from testing.helpers import authenticate
	authenticate(client, _User.objects.get(username=username))


class PasswordChangeFlagTests(TestCase):
	def test_change_password_clears_must_change_password_flag(self):
		client = APIClient()
		user = User.objects.create_user(
			username="mustchange",
			password="old-pass-123",
			role=UserRole.USER,
			must_change_password=True,
		)

		resp = client.post("/api/v1/auth/token/", {"username": user.username, "password": "old-pass-123"})
		self.assertEqual(resp.status_code, 200)
		_cookie_auth(client, user.username, "old-pass-123")

		change_resp = client.post(
			"/api/v1/auth/me/change-password/",
			{"old_password": "old-pass-123", "new_password": "new-pass-1234"},
		)

		self.assertEqual(change_resp.status_code, 200)
		user.refresh_from_db()
		self.assertFalse(user.must_change_password)


class TokenLoginCredentialTests(TestCase):
	def test_login_accepts_email(self):
		client = APIClient()
		user = User.objects.create_user(
			username="email_login",
			email="email-login@example.com",
			password="pass1234",
			role=UserRole.USER,
		)

		resp = client.post(
			"/api/v1/auth/token/",
			{"email": user.email, "password": "pass1234"},
		)

		self.assertEqual(resp.status_code, 200)
		# Tokens are now delivered as httpOnly cookies, not in the response body
		self.assertIn("openzev_access", resp.cookies)
		self.assertIn("openzev_refresh", resp.cookies)
		self.assertNotIn("access", resp.data)
		self.assertNotIn("refresh", resp.data)


class PasswordLoginAuditTests(TestCase):
	def test_a_successful_login_is_audited(self):
		client = APIClient()
		user = User.objects.create_user(
			username="audit_login_ok",
			email="audit-login-ok@example.com",
			password="pass1234",
			role=UserRole.USER,
		)

		resp = client.post(
			"/api/v1/auth/token/",
			{"username": user.username, "password": "pass1234"},
		)

		self.assertEqual(resp.status_code, 200)
		event = AuditEvent.objects.get(action_type="auth.login")
		self.assertEqual(event.action_category, AuditActionCategory.AUTH)
		self.assertEqual(event.status, AuditEventStatus.SUCCESS)
		self.assertEqual(event.target_id, str(user.pk))
		self.assertEqual(event.target_display, user.email)
		self.assertEqual(event.actor_user_id, user.pk)

	def test_a_wrong_password_is_audited_without_revealing_which_part_was_wrong(self):
		client = APIClient()
		user = User.objects.create_user(
			username="audit_login_badpass",
			email="audit-login-badpass@example.com",
			password="pass1234",
			role=UserRole.USER,
		)

		resp = client.post(
			"/api/v1/auth/token/",
			{"username": user.username, "password": "wrong-password"},
		)

		self.assertEqual(resp.status_code, 401)
		event = AuditEvent.objects.get(action_type="auth.login_failed")
		self.assertEqual(event.action_category, AuditActionCategory.AUTH)
		self.assertEqual(event.status, AuditEventStatus.FAILED)
		self.assertEqual(event.target_display, user.username)
		# No account is attributed as actor — this is exactly the caller,
		# authenticated or not, that failed to prove who it is.
		self.assertIsNone(event.actor_user_id)

	def test_an_unknown_username_is_audited_with_the_attempted_identifier(self):
		client = APIClient()

		resp = client.post(
			"/api/v1/auth/token/",
			{"username": "nobody-like-this", "password": "whatever1234"},
		)

		self.assertEqual(resp.status_code, 401)
		event = AuditEvent.objects.get(action_type="auth.login_failed")
		self.assertEqual(event.target_display, "nobody-like-this")

	def test_an_inactive_account_login_is_audited_as_a_failure(self):
		"""Django's ModelBackend rejects inactive users the same way as a
		wrong password — deliberately indistinguishable to the caller, but
		still worth an audit row."""
		client = APIClient()
		user = User.objects.create_user(
			username="audit_login_inactive",
			password="pass1234",
			role=UserRole.USER,
			is_active=False,
		)

		resp = client.post(
			"/api/v1/auth/token/",
			{"username": user.username, "password": "pass1234"},
		)

		self.assertEqual(resp.status_code, 401)
		event = AuditEvent.objects.get(action_type="auth.login_failed")
		self.assertEqual(event.target_display, user.username)

	def test_a_request_with_no_identifier_is_still_audited(self):
		client = APIClient()

		resp = client.post("/api/v1/auth/token/", {"password": "whatever1234"})

		self.assertEqual(resp.status_code, 400)
		event = AuditEvent.objects.get(action_type="auth.login_failed")
		self.assertEqual(event.target_display, "")


class RegistrationTests(TestCase):
	def setUp(self):
		cache.clear()

	def post_register(self, email):
		return APIClient().post("/api/v1/auth/register/", {"email": email}, format="json")

	def make_pending(self, email="pend@example.com", purpose="signup", **fields):
		user = User.objects.create_user(username=email.split("@")[0], email=email, is_active=False, **fields)
		user.set_unusable_password()
		user.save()
		EmailVerificationToken.objects.create(user=user, token=f"old-{email}", purpose=purpose)
		return user

	def test_mail_failure_keeps_the_pending_account_and_lets_the_user_retry(self):
		User.objects.create_user(username="registered", email="registered@example.com")
		with mock.patch("accounts.views.EmailMessage.send", side_effect=OSError("smtp down")):
			existing = self.post_register("registered@example.com")
			new = self.post_register("new@example.com")
		self.assertEqual((new.status_code, new.data), (existing.status_code, existing.data))
		self.assertEqual(existing.status_code, 201)
		pending = User.objects.get(email="new@example.com")
		self.assertFalse(pending.is_active)
		self.post_register("new@example.com")
		self.assertEqual(len(mail.outbox), 1)
		self.assertEqual(pending.email_verification_tokens.count(), 1)

	def test_register_validates_email_before_creating_an_account(self):
		client = APIClient()
		for invalid in ("invalid", "a@", "", None, [], {}):
			with self.subTest(email=invalid):
				response = client.post("/api/v1/auth/register/", {"email": invalid}, format="json")
				self.assertEqual(response.status_code, 400)
		self.assertFalse(User.objects.exists())
		self.assertFalse(EmailVerificationToken.objects.exists())

	def test_register_rejects_email_over_model_limit_before_issuance(self):
		email = "a@" + ".".join(("b" * 63, "c" * 63, "d" * 63, "e" * 57, "com"))
		self.assertEqual(len(email), User._meta.get_field("email").max_length + 1)
		with mock.patch("accounts.views._reserve_mail_slot") as reserve, mock.patch(
			"accounts.views._prepare_signup_link", return_value=None
		) as prepare, mock.patch("accounts.views.logger.exception") as log_error:
			response = self.post_register(email)
		self.assertEqual(response.status_code, 400)
		self.assertIn("email", response.data)
		reserve.assert_not_called()
		prepare.assert_not_called()
		log_error.assert_not_called()
		self.assertFalse(User.objects.exists())
		self.assertFalse(EmailVerificationToken.objects.exists())
		self.assertEqual(len(mail.outbox), 0)

	def test_register_accepts_email_at_model_limit(self):
		email = "a@" + ".".join(("b" * 63, "c" * 63, "d" * 63, "e" * 56, "com"))
		self.assertEqual(len(email), User._meta.get_field("email").max_length)
		response = self.post_register(email)
		self.assertEqual(response.status_code, 201)
		user = User.objects.get(email=email)
		self.assertEqual(user.email_verification_tokens.count(), 1)
		self.assertEqual(len(mail.outbox), 1)

	def test_register_unsafe_template_uses_the_default_verification_link(self):
		EmailTemplate.objects.create(
			template_key="email_verification", subject="Verify", body="{verify_url.__class__}",
		)
		response = APIClient().post("/api/v1/auth/register/", {"email": "safe@example.com"}, format="json")
		self.assertEqual(response.status_code, 201)
		self.assertIn("/verify-email?token=", mail.outbox[-1].body)
		self.assertNotIn("<class", mail.outbox[-1].body)

	def test_register_accepts_email_only_and_generates_username(self):
		client = APIClient()

		resp = client.post(
			"/api/v1/auth/register/",
			{"email": "new.owner@example.com"},
			format="json",
		)

		self.assertEqual(resp.status_code, 201)
		user = User.objects.get(email__iexact="new.owner@example.com")
		self.assertEqual(user.username, "newowner")
		self.assertEqual(user.role, UserRole.USER)
		self.assertFalse(user.is_active)
		self.assertTrue(user.must_change_password)
		self.assertGreaterEqual(len(mail.outbox), 1)

	def test_register_template_uses_the_send_time_context(self):
		EmailTemplate.objects.create(
			template_key="email_verification",
			subject="Verify {verify_url}",
			body="Verify {verify_url}",
		)
		client = APIClient()

		resp = client.post(
			"/api/v1/auth/register/",
			{"email": "verify.fields@example.com"},
			format="json",
		)

		self.assertEqual(resp.status_code, 201)
		message = mail.outbox[-1]
		self.assertTrue(message.subject.startswith("Verify http"))
		self.assertIn("/verify-email?token=", message.subject)
		self.assertTrue(message.body.startswith("Verify http"))
		self.assertIn("/verify-email?token=", message.body)

	def test_register_duplicate_email_is_indistinguishable_and_does_not_create_token(self):
		User.objects.create_user(
			username="existing.owner",
			email="existing.owner@example.com",
			password="pass1234",
			role=UserRole.USER,
		)
		client = APIClient()

		resp = client.post(
			"/api/v1/auth/register/",
			{"email": "EXISTING.OWNER@example.com"},
			format="json",
		)

		self.assertEqual(resp.status_code, 201)
		self.assertEqual(resp.data["detail"], "If that address can be used, check your inbox.")
		self.assertFalse(EmailVerificationToken.objects.exists())
		self.assertEqual(len(mail.outbox), 0)

	def test_repeated_probes_of_an_existing_address_send_no_mail(self):
		User.objects.create_user(username="known", email="known@example.com", password="pass1234")
		client = APIClient()
		for _ in range(3):
			self.assertEqual(client.post("/api/v1/auth/register/", {"email": "known@example.com"}, format="json").status_code, 201)
		self.assertEqual(len(mail.outbox), 0)

	def test_registering_again_resends_the_link_and_retires_the_old_one(self):
		self.post_register("pending@example.com")
		cache.clear()
		self.assertEqual(self.post_register("pending@example.com").status_code, 201)
		user = User.objects.get(email="pending@example.com")
		self.assertEqual(User.objects.filter(email="pending@example.com").count(), 1)
		self.assertEqual(user.email_verification_tokens.count(), 1)
		self.assertEqual(len(mail.outbox), 2)
		self.assertIn(user.email_verification_tokens.get().token, mail.outbox[-1].body)

	def test_an_expired_signup_can_be_restarted(self):
		user = self.make_pending()
		EmailVerificationToken.objects.filter(user=user).update(created_at=timezone.now() - timedelta(days=30))
		self.post_register(user.email)
		self.assertEqual(len(mail.outbox), 1)

	def test_a_failed_resend_keeps_the_old_link_and_can_be_retried_at_once(self):
		user = self.make_pending()
		with mock.patch("accounts.views.EmailMessage.send", side_effect=OSError("smtp down")):
			self.assertEqual(self.post_register(user.email).status_code, 201)
		self.assertTrue(user.email_verification_tokens.filter(token=f"old-{user.email}").exists())
		self.post_register(user.email)
		self.assertEqual(len(mail.outbox), 1)
		self.assertEqual(user.email_verification_tokens.count(), 1)

	def test_only_one_request_per_address_sends_within_the_window(self):
		user = self.make_pending()
		cache.add("register-mail:" + hashlib.sha256(user.email.encode()).hexdigest(), "other-request", 60)
		self.assertEqual(self.post_register(user.email).status_code, 201)
		self.assertEqual(len(mail.outbox), 0)

	def test_a_stale_request_does_not_free_a_newer_requests_reservation(self):
		from accounts.views import _release_mail_slot, _reserve_mail_slot
		cache.clear()
		mine = _reserve_mail_slot("k")
		cache.set("k", "newer")
		_release_mail_slot("k", mine)
		self.assertEqual(cache.get("k"), "newer")

	def test_established_and_disabled_accounts_get_no_mail_or_token(self):
		User.objects.create_user(username="known", email="known@example.com", password="pass1234")
		User.objects.create_user(username="off", email="off@example.com", password="pass1234", is_active=False)
		for email in ("known@example.com", "off@example.com"):
			self.assertEqual(self.post_register(email).status_code, 201)
		self.assertEqual(len(mail.outbox), 0)
		self.assertFalse(EmailVerificationToken.objects.exists())

	def test_an_invitation_account_does_not_get_a_signup_link(self):
		user = self.make_pending("invited@example.com", purpose="invitation", may_create_zev=False)
		self.post_register(user.email)
		self.assertEqual(len(mail.outbox), 0)
		self.assertEqual(user.email_verification_tokens.count(), 1)

	def test_a_verified_then_disabled_account_does_not_get_a_signup_link(self):
		user = self.make_pending("gone@example.com")
		EmailVerificationToken.objects.filter(user=user).update(consumed_at=timezone.now())
		self.post_register(user.email)
		self.assertEqual(len(mail.outbox), 0)
		self.assertEqual(user.email_verification_tokens.count(), 1)

	def test_a_taken_username_is_retried_during_account_creation(self):
		User.objects.create_user(username="race", email="another@example.com")
		real_filter = User.objects.filter
		checked = False

		def miss_concurrent_username(*args, **kwargs):
			nonlocal checked
			if kwargs == {"username": "race"} and not checked:
				checked = True
				query = mock.Mock()
				query.exists.return_value = False
				return query
			return real_filter(*args, **kwargs)

		with mock.patch.object(User.objects, "filter", side_effect=miss_concurrent_username):
			self.assertEqual(self.post_register("race@example.com").status_code, 201)
		self.assertEqual(User.objects.get(email="race@example.com").username, "race2")
		self.assertEqual(len(mail.outbox), 1)

	def test_unrelated_integrity_failures_are_not_retried(self):
		from django.db import IntegrityError

		with mock.patch.object(User.objects, "create_user", side_effect=IntegrityError("other constraint")) as create:
			self.assertEqual(self.post_register("error@example.com").status_code, 201)
		create.assert_called_once()
		self.assertFalse(User.objects.exists())
		self.assertFalse(EmailVerificationToken.objects.exists())

	def test_initial_token_failure_rolls_back_the_account_and_allows_retry(self):
		with mock.patch.object(EmailVerificationToken.objects, "create", side_effect=RuntimeError("token write failed")):
			self.assertEqual(self.post_register("retry@example.com").status_code, 201)
		self.assertFalse(User.objects.exists())
		self.assertFalse(EmailVerificationToken.objects.exists())
		self.assertEqual(self.post_register("retry@example.com").status_code, 201)
		self.assertEqual(User.objects.count(), 1)
		self.assertEqual(EmailVerificationToken.objects.count(), 1)
		self.assertEqual(len(mail.outbox), 1)

	def test_pending_signup_cancellation_invalidates_its_link(self):
		from testing.helpers import authenticate, make_user

		user = self.make_pending()
		token = user.email_verification_tokens.get()
		client = APIClient()
		authenticate(client, make_user("cancel_admin", UserRole.ADMIN))
		response = client.patch(
			f"/api/v1/auth/users/{user.pk}/", {"first_name": "Corrected", "is_active": False}, format="json",
		)
		self.assertEqual(response.status_code, 200)
		response = APIClient().post("/api/v1/auth/verify-email/", {"token": token.token}, format="json")
		self.assertEqual(response.status_code, 400)
		self.post_register(user.email)
		user.refresh_from_db()
		self.assertFalse(user.is_active)
		self.assertEqual(user.session_version, 0)
		self.assertFalse(user.email_verification_tokens.exists())
		self.assertEqual(len(mail.outbox), 0)

	def test_unrelated_pending_account_edit_preserves_its_link(self):
		from testing.helpers import authenticate, make_user

		user = self.make_pending()
		token = user.email_verification_tokens.get()
		client = APIClient()
		authenticate(client, make_user("edit_admin", UserRole.ADMIN))
		# The admin edit form resubmits these fields and omits is_active.
		payload = {field: getattr(user, field) for field in (
			"username", "email", "first_name", "last_name", "role", "must_change_password",
		)}
		payload["first_name"] = "Pending"
		response = client.patch(f"/api/v1/auth/users/{user.pk}/", payload, format="json")
		self.assertEqual(response.status_code, 200)
		response = APIClient().post("/api/v1/auth/verify-email/", {"token": token.token}, format="json")
		self.assertEqual(response.status_code, 200)

	def test_non_object_registration_payload_is_refused(self):
		response = APIClient().post("/api/v1/auth/register/", [], format="json")
		self.assertEqual(response.status_code, 400)
		self.assertFalse(User.objects.exists())

	def test_cache_outages_return_a_controlled_error_before_issuance(self):
		from redis.exceptions import ConnectionError
		from .throttling import AuthRegisterThrottle

		for operation in ("get", "set", "add"):
			cache.clear()
			with (
				self.subTest(operation=operation),
				mock.patch.object(AuthRegisterThrottle, "THROTTLE_RATES", {"auth_register": "100/hour"}),
				mock.patch.object(cache, operation, side_effect=ConnectionError("cache down")),
			):
				response = self.post_register("outage@example.com")
				self.assertEqual(response.status_code, 503)
		self.assertFalse(User.objects.exists())
		self.assertFalse(EmailVerificationToken.objects.exists())

	def test_active_accounts_cannot_use_an_unused_activation_link(self):
		user = self.make_pending()
		token = user.email_verification_tokens.get()
		user.is_active = True
		user.save(update_fields=["is_active"])
		response = APIClient().post("/api/v1/auth/verify-email/", {"token": token.token}, format="json")
		self.assertEqual(response.status_code, 400)
		self.assertNotIn("openzev_access", response.cookies)

	def test_invalid_verification_payloads_are_refused_before_lookup(self):
		invalid = ([], "token", None, {}, *({"token": value} for value in (None, 123, True, [], {}, "", "x" * 65)))
		for payload in invalid:
			with (
				self.subTest(payload=payload),
				mock.patch.object(EmailVerificationToken.objects, "filter", side_effect=AssertionError("Invalid token queried")),
			):
				response = APIClient().post("/api/v1/auth/verify-email/", payload, format="json")
			self.assertEqual(response.status_code, 400)

	def test_verification_accepts_a_maximum_length_token(self):
		user = self.make_pending()
		token = user.email_verification_tokens.get()
		token.token = "v" * 64
		token.save(update_fields=["token"])
		response = APIClient().post("/api/v1/auth/verify-email/", {"token": f" {token.token} "}, format="json")
		self.assertEqual(response.status_code, 200)
		user.refresh_from_db()
		self.assertTrue(user.is_active)

	def test_failed_reservation_release_does_not_change_the_public_response(self):
		from redis.exceptions import ConnectionError

		with (
			mock.patch("accounts.views.EmailMessage.send", side_effect=OSError("smtp down")),
			mock.patch("accounts.views.delete_if_value", side_effect=ConnectionError("cache down")),
		):
			response = self.post_register("failed@example.com")
		self.assertEqual(response.status_code, 201)
		self.assertEqual(EmailVerificationToken.objects.count(), 1)

	def test_post_delivery_cleanup_failure_keeps_the_cooldown(self):
		with mock.patch("accounts.views._retire_previous_signup_links", side_effect=RuntimeError("cleanup failed")):
			self.assertEqual(self.post_register("sent@example.com").status_code, 201)
		self.assertEqual(self.post_register("sent@example.com").status_code, 201)
		self.assertEqual(len(mail.outbox), 1)

	def test_admin_deactivation_kills_outstanding_activation_links(self):
		from testing.helpers import authenticate, make_user
		user = self.make_pending()
		admin_client = APIClient()
		authenticate(admin_client, make_user("reg_admin", UserRole.ADMIN))
		admin_client.patch(f"/api/v1/auth/users/{user.pk}/", {"is_active": True}, format="json")
		EmailVerificationToken.objects.create(user=user, token="late")
		admin_client.patch(f"/api/v1/auth/users/{user.pk}/", {"is_active": False}, format="json")
		resp = APIClient().post("/api/v1/auth/verify-email/", {"token": "late"}, format="json")
		self.assertEqual(resp.status_code, 400)

	def test_verifying_retires_every_other_unused_link(self):
		user = self.make_pending()
		EmailVerificationToken.objects.create(user=user, token="second")
		resp = APIClient().post("/api/v1/auth/verify-email/", {"token": "second"}, format="json")
		self.assertEqual(resp.status_code, 200)
		self.assertEqual(list(user.email_verification_tokens.values_list("token", flat=True)), ["second"])

	def test_login_still_accepts_username(self):
		client = APIClient()
		user = User.objects.create_user(
			username="username_login",
			email="username-login@example.com",
			password="pass1234",
			role=UserRole.USER,
		)

		resp = client.post(
			"/api/v1/auth/token/",
			{"username": user.username, "password": "pass1234"},
		)

		self.assertEqual(resp.status_code, 200)
		self.assertIn("openzev_access", resp.cookies)
		self.assertIn("openzev_refresh", resp.cookies)
		self.assertNotIn("access", resp.data)
		self.assertNotIn("refresh", resp.data)

	def test_register_blocked_when_self_registration_feature_disabled(self):
		FeatureFlag.sync_defaults()
		flag = FeatureFlag.objects.get(name=FeatureFlag.ZEV_SELF_REGISTRATION_ENABLED)
		flag.enabled = False
		flag.save(update_fields=["enabled"])

		client = APIClient()
		resp = client.post(
			"/api/v1/auth/register/",
			{"email": "blocked.owner@example.com"},
			format="json",
		)

		self.assertEqual(resp.status_code, 403)
		self.assertIn("detail", resp.data)


class FeatureFlagRegistryTests(SimpleTestCase):
    def test_every_registered_description_fits_its_column(self):
        # SQLite does not enforce varchar lengths, PostgreSQL does: a long
        # description only fails in the second CI leg, and then on every request.
        limit = FeatureFlag._meta.get_field("description").max_length
        too_long = {name: len(text) for name, text in FeatureFlag.DESCRIPTIONS.items() if len(text) > limit}
        self.assertEqual(too_long, {})


class FeatureFlagsApiTests(TestCase):
	def test_feature_flags_list_requires_admin(self):
		client = APIClient()
		# Anonymous callers are rejected with 401 (unauthenticated).
		resp = client.get("/api/v1/auth/feature-flags/")
		self.assertEqual(resp.status_code, 401)

		# Non-admin authenticated callers are denied with 403.
		User.objects.create_user(username="owner_ff", password="pass1234", role=UserRole.USER)
		_cookie_auth(client, "owner_ff", "pass1234")
		resp = client.get("/api/v1/auth/feature-flags/")
		self.assertEqual(resp.status_code, 403)

	def test_feature_flags_list_visible_to_admin(self):
		client = APIClient()
		User.objects.create_user(username="admin_ff", password="pass1234", role=UserRole.ADMIN)
		_cookie_auth(client, "admin_ff", "pass1234")

		resp = client.get("/api/v1/auth/feature-flags/")
		self.assertEqual(resp.status_code, 200)
		self.assertTrue(
			any(flag["name"] == FeatureFlag.ZEV_SELF_REGISTRATION_ENABLED for flag in resp.data)
		)

	def test_registration_enabled_is_public_and_minimal(self):
		client = APIClient()
		resp = client.get("/api/v1/auth/registration-enabled/")

		self.assertEqual(resp.status_code, 200)
		# Only a boolean is exposed — no flag names/descriptions leak.
		self.assertEqual(set(resp.data.keys()), {"enabled"})
		self.assertIsInstance(resp.data["enabled"], bool)

	def test_registration_enabled_reflects_disabled_flag(self):
		# Guard against a FEATURE_* env-var override shadowing the DB value.
		env_key = f"FEATURE_{FeatureFlag.ZEV_SELF_REGISTRATION_ENABLED.upper()}"
		with mock.patch.dict("os.environ"):
			os.environ.pop(env_key, None)
			FeatureFlag.sync_defaults()
			flag = FeatureFlag.objects.get(name=FeatureFlag.ZEV_SELF_REGISTRATION_ENABLED)
			flag.enabled = False
			flag.save(update_fields=["enabled"])

			resp = APIClient().get("/api/v1/auth/registration-enabled/")

		self.assertEqual(resp.status_code, 200)
		self.assertEqual(resp.data, {"enabled": False})

	def test_anonymous_access_does_not_write_feature_flags(self):
		# The public endpoint must be read-only: no default-sync writes.
		self.assertEqual(FeatureFlag.objects.count(), 0)

		resp = APIClient().get("/api/v1/auth/registration-enabled/")
		self.assertEqual(resp.status_code, 200)
		self.assertEqual(FeatureFlag.objects.count(), 0)

		# The admin-only list is denied before its body (and sync) runs.
		resp = APIClient().get("/api/v1/auth/feature-flags/")
		self.assertEqual(resp.status_code, 401)
		self.assertEqual(FeatureFlag.objects.count(), 0)


class ImpersonationTests(TestCase):
	def _auth(self, client, user, password="pass1234"):
		_cookie_auth(client, user.username, password)

	def test_admin_can_impersonate_participant(self):
		client = APIClient()
		admin = User.objects.create_user(username="admin_imp", password="pass1234", role=UserRole.ADMIN)
		participant = User.objects.create_user(username="part_imp", password="pass1234", role=UserRole.USER)
		self._auth(client, admin)

		resp = client.post(f"/api/v1/auth/users/{participant.id}/impersonate/")

		self.assertEqual(resp.status_code, 200)
		# Tokens delivered as cookies, not in body
		self.assertIn("openzev_access", resp.cookies)
		self.assertNotIn("access", resp.data)
		self.assertEqual(resp.data["impersonated_user"]["id"], participant.id)

	def test_non_admin_cannot_impersonate(self):
		client = APIClient()
		owner = User.objects.create_user(username="owner_imp", password="pass1234", role=UserRole.USER)
		participant = User.objects.create_user(username="part_imp_2", password="pass1234", role=UserRole.USER)
		self._auth(client, owner)

		resp = client.post(f"/api/v1/auth/users/{participant.id}/impersonate/")

		self.assertEqual(resp.status_code, 403)

	def test_admin_cannot_impersonate_non_participant(self):
		client = APIClient()
		admin = User.objects.create_user(username="admin_imp_2", password="pass1234", role=UserRole.ADMIN)
		owner = User.objects.create_user(username="owner_imp_2", password="pass1234", role=UserRole.USER)
		self._auth(client, admin)

		resp = client.post(f"/api/v1/auth/users/{owner.id}/impersonate/")

		self.assertEqual(resp.status_code, 200)
		self.assertIn("openzev_access", resp.cookies)
		self.assertEqual(resp.data["impersonated_user"]["id"], owner.id)

	def test_admin_cannot_impersonate_admin(self):
		client = APIClient()
		admin = User.objects.create_user(username="admin_imp_3", password="pass1234", role=UserRole.ADMIN)
		other_admin = User.objects.create_user(username="admin_imp_4", password="pass1234", role=UserRole.ADMIN)
		self._auth(client, admin)

		resp = client.post(f"/api/v1/auth/users/{other_admin.id}/impersonate/")

		self.assertEqual(resp.status_code, 400)


class LinkedAccountSafetyTests(TestCase):
	def _auth(self, client, user, password="pass1234"):
		_cookie_auth(client, user.username, password)

	def setUp(self):
		self.client = APIClient()
		self.admin = User.objects.create_user(username="admin_safety", password="pass1234", role=UserRole.ADMIN)
		self.owner = User.objects.create_user(username="owner_safety", password="pass1234", role=UserRole.USER)
		self.linked_account = User.objects.create_user(username="linked_account", password="pass1234", role=UserRole.USER)
		self.unlinked_account = User.objects.create_user(username="unlinked_account", password="pass1234", role=UserRole.USER)

		zev = create_managed_zev(name="Safety ZEV", owner=self.owner, zev_type="vzev", invoice_prefix="S")
		Participant.objects.create(
			zev=zev,
			user=self.linked_account,
			first_name="Linked",
			last_name="Person",
			email="linked@example.com",
			valid_from=date(2026, 1, 1),
		)

		self._auth(self.client, self.admin)

	def test_admin_can_edit_linked_account(self):
		resp = self.client.patch(
			f"/api/v1/auth/users/{self.linked_account.id}/",
			{"first_name": "Updated", "role": "user"},
			format="json",
		)
		self.assertEqual(resp.status_code, 200)
		self.linked_account.refresh_from_db()
		self.assertEqual(self.linked_account.first_name, "Updated")
		self.assertEqual(self.linked_account.role, "user")

	def test_admin_cannot_delete_linked_account(self):
		resp = self.client.delete(f"/api/v1/auth/users/{self.linked_account.id}/")
		self.assertEqual(resp.status_code, 403)

	def test_admin_can_edit_and_delete_unlinked_account(self):
		update_resp = self.client.patch(
			f"/api/v1/auth/users/{self.unlinked_account.id}/",
			{"first_name": "Allowed"},
			format="json",
		)
		delete_resp = self.client.delete(f"/api/v1/auth/users/{self.unlinked_account.id}/")

		self.assertEqual(update_resp.status_code, 200)
		self.assertEqual(delete_resp.status_code, 204)

	def test_admin_cannot_delete_last_admin(self):
		resp = self.client.delete(f"/api/v1/auth/users/{self.admin.id}/")
		self.assertEqual(resp.status_code, 403)
		self.assertTrue(User.objects.filter(pk=self.admin.pk).exists())
		self.assertTrue(
			AuditEvent.objects.filter(
				action_type="user.delete",
				status="denied",
				target_id=str(self.admin.pk),
			).exists()
		)

	def test_admin_can_delete_self_when_other_admin_exists(self):
		User.objects.create_user(username="admin_two", password="pass1234", role=UserRole.ADMIN)
		admin_pk = self.admin.pk
		admin_display = self.admin.email or self.admin.username
		resp = self.client.delete(f"/api/v1/auth/users/{admin_pk}/")
		self.assertEqual(resp.status_code, 204)
		self.assertFalse(User.objects.filter(pk=admin_pk).exists())
		# Audit event survives self-deletion; actor FK is SET_NULL.
		event = AuditEvent.objects.get(
			action_type="user.delete", target_id=str(admin_pk), status="success",
		)
		self.assertEqual(event.target_display, admin_display)
		self.assertIsNone(event.actor_user)

	def test_admin_can_delete_other_admin_when_multiple_exist(self):
		admin2 = User.objects.create_user(username="admin_two", password="pass1234", role=UserRole.ADMIN)
		resp = self.client.delete(f"/api/v1/auth/users/{admin2.id}/")
		self.assertEqual(resp.status_code, 204)
		self.assertFalse(User.objects.filter(pk=admin2.pk).exists())

	def test_admin_cannot_change_own_role_via_user_detail(self):
		resp = self.client.patch(
			f"/api/v1/auth/users/{self.admin.id}/",
			{"role": UserRole.USER},
			format="json",
		)
		self.assertEqual(resp.status_code, 400)

	def test_admin_cannot_change_own_role_via_me(self):
		resp = self.client.patch(
			"/api/v1/auth/me/",
			{"role": UserRole.USER},
			format="json",
		)
		self.assertEqual(resp.status_code, 400)


class MeEndpointParticipantContextTests(TestCase):
	def _auth(self, client, user, password="pass1234"):
		_cookie_auth(client, user.username, password)

	def test_participant_me_lists_its_community(self):
		client = APIClient()
		owner = User.objects.create_user(username="owner_me", password="pass1234", role=UserRole.USER)
		zev = create_managed_zev(name="Context ZEV", owner=owner, zev_type="vzev", invoice_prefix="C")
		participant_user = User.objects.create_user(username="p_me", password="pass1234", role=UserRole.USER)
		Participant.objects.create(
			zev=zev,
			user=participant_user,
			first_name="Anna",
			last_name="Consumer",
			email="anna@example.com",
			valid_from=date(2026, 1, 1),
		)

		self._auth(client, participant_user)
		resp = client.get("/api/v1/auth/me/")

		self.assertEqual(resp.status_code, 200)
		self.assertEqual([m["zev_name"] for m in resp.data["memberships"]], ["Context ZEV"])
		# The single-community name and count gave way to memberships (#761).
		self.assertNotIn("zev_name", resp.data)
		self.assertNotIn("zev_count", resp.data)

	def test_participant_me_carries_its_communitys_billing_interval(self):
		client = APIClient()
		owner = User.objects.create_user(username="owner_interval", password="pass1234", role=UserRole.USER)
		zev = create_managed_zev(
			name="Quarterly ZEV", owner=owner, zev_type="vzev", invoice_prefix="Q",
			billing_interval=BillingInterval.QUARTERLY,
		)
		participant_user = User.objects.create_user(username="p_interval", password="pass1234", role=UserRole.USER)
		Participant.objects.create(
			zev=zev,
			user=participant_user,
			first_name="Anna",
			last_name="Consumer",
			email="anna.q@example.com",
			valid_from=date(2026, 1, 1),
		)

		self._auth(client, participant_user)
		resp = client.get("/api/v1/auth/me/")

		self.assertEqual(resp.status_code, 200)
		self.assertEqual([m["zev_billing_interval"] for m in resp.data["memberships"]], ["quarterly"])

	def test_admin_me_has_no_community_name(self):
		client = APIClient()
		admin = User.objects.create_user(username="admin_me", password="pass1234", role=UserRole.ADMIN)

		self._auth(client, admin)
		resp = client.get("/api/v1/auth/me/")

		self.assertEqual(resp.status_code, 200)
		self.assertNotIn("zev_name", resp.data)
		self.assertEqual(resp.data["memberships"], [])

	def test_account_without_membership_lists_none(self):
		client = APIClient()
		participant_user = User.objects.create_user(username="p_lone", password="pass1234", role=UserRole.USER)

		self._auth(client, participant_user)
		resp = client.get("/api/v1/auth/me/")

		self.assertEqual(resp.status_code, 200)
		self.assertEqual(resp.data["memberships"], [])

	def test_participant_with_two_memberships_lists_both(self):
		client = APIClient()
		owner = User.objects.create_user(username="owner_multi", password="pass1234", role=UserRole.USER)
		first_zev = create_managed_zev(name="First ZEV", owner=owner, zev_type="vzev", invoice_prefix="F")
		second_zev = create_managed_zev(name="Second ZEV", owner=owner, zev_type="vzev", invoice_prefix="S")
		participant_user = User.objects.create_user(username="p_multi", password="pass1234", role=UserRole.USER)
		Participant.objects.create(
			zev=first_zev,
			user=participant_user,
			first_name="Zed",
			last_name="Zulu",
			email="zed@example.com",
			valid_from=date(2026, 1, 1),
		)
		Participant.objects.create(
			zev=second_zev,
			user=participant_user,
			first_name="Anna",
			last_name="Aar",
			email="anna@example.com",
			valid_from=date(2026, 1, 1),
		)

		self._auth(client, participant_user)
		resp = client.get("/api/v1/auth/me/")

		self.assertEqual(resp.status_code, 200)
		self.assertEqual([m["zev_name"] for m in resp.data["memberships"]], ["First ZEV", "Second ZEV"])


class AppSettingsTests(TestCase):
	def _auth(self, client, user, password="pass1234"):
		_cookie_auth(client, user.username, password)

	def setUp(self):
		self.client = APIClient()
		self.admin = User.objects.create_user(username="admin_settings", password="pass1234", role=UserRole.ADMIN)
		self.owner = User.objects.create_user(username="owner_settings", password="pass1234", role=UserRole.USER)

	def _enable_policy(self):
		AppSettings.load()  # the row must exist before .update() can touch it
		AppSettings.objects.update(mfa_required=True, mfa_grace_period_days=30)

	def test_authenticated_user_can_read_settings(self):
		self._auth(self.client, self.owner)

		resp = self.client.get("/api/v1/auth/app-settings/")

		self.assertEqual(resp.status_code, 200)
		self.assertEqual(resp.data["date_format_short"], AppSettings.SHORT_DATE_DD_MM_YYYY)
		self.assertEqual(resp.data["date_format_long"], AppSettings.LONG_DATE_D_MMMM_YYYY)
		self.assertEqual(resp.data["date_time_format"], AppSettings.DATETIME_DD_MM_YYYY_HH_MM)

	def test_non_admin_read_omits_the_mfa_policy(self):
		self._enable_policy()
		self._auth(self.client, self.owner)

		resp = self.client.get("/api/v1/auth/app-settings/")

		self.assertEqual(resp.status_code, 200)
		self.assertEqual(
			set(resp.data),
			{"date_format_short", "date_format_long", "date_time_format", "updated_at"},
		)

	def test_admin_read_includes_the_mfa_policy(self):
		self._enable_policy()
		self._auth(self.client, self.admin)

		resp = self.client.get("/api/v1/auth/app-settings/")

		self.assertEqual(resp.status_code, 200)
		self.assertIs(resp.data["mfa_required"], True)
		self.assertEqual(resp.data["mfa_grace_period_days"], 30)
		self.assertEqual(resp.data["date_format_short"], AppSettings.SHORT_DATE_DD_MM_YYYY)

	def test_admin_can_update_settings(self):
		self._auth(self.client, self.admin)

		resp = self.client.patch(
			"/api/v1/auth/app-settings/",
			{
				"date_format_short": AppSettings.SHORT_DATE_YYYY_MM_DD,
				"date_format_long": AppSettings.LONG_DATE_MMMM_D_YYYY,
				"date_time_format": AppSettings.DATETIME_YYYY_MM_DD_HH_MM,
			},
			format="json",
		)

		self.assertEqual(resp.status_code, 200)
		# The admin form caches this response, so it must carry the policy too.
		self.assertIn("mfa_required", resp.data)
		self.assertIn("mfa_grace_period_days", resp.data)
		settings_obj = AppSettings.load()
		self.assertEqual(settings_obj.date_format_short, AppSettings.SHORT_DATE_YYYY_MM_DD)
		self.assertEqual(settings_obj.date_format_long, AppSettings.LONG_DATE_MMMM_D_YYYY)
		self.assertEqual(settings_obj.date_time_format, AppSettings.DATETIME_YYYY_MM_DD_HH_MM)

	def test_non_admin_cannot_update_settings(self):
		self._auth(self.client, self.owner)

		resp = self.client.patch(
			"/api/v1/auth/app-settings/",
			{"date_format_short": AppSettings.SHORT_DATE_YYYY_MM_DD},
			format="json",
		)

		self.assertEqual(resp.status_code, 403)


class VatRateSettingsTests(TestCase):
	def _auth(self, client, user, password="pass1234"):
		_cookie_auth(client, user.username, password)

	def setUp(self):
		self.client = APIClient()
		self.admin = User.objects.create_user(username="admin_vat", password="pass1234", role=UserRole.ADMIN)
		self.owner = User.objects.create_user(username="owner_vat", password="pass1234", role=UserRole.USER)
		clear_vat_rates()

	def test_admin_can_crud_vat_rates(self):
		self._auth(self.client, self.admin)

		create_resp = self.client.post(
			"/api/v1/auth/vat-rates/",
			{"rate": "0.0810", "valid_from": "2026-01-01", "valid_to": None},
			format="json",
		)
		self.assertEqual(create_resp.status_code, 201)
		rate_id = create_resp.data["id"]

		list_resp = self.client.get("/api/v1/auth/vat-rates/")
		self.assertEqual(list_resp.status_code, 200)
		self.assertEqual(len(list_resp.data["results"]), 1)

		patch_resp = self.client.patch(
			f"/api/v1/auth/vat-rates/{rate_id}/",
			{"rate": "0.0820"},
			format="json",
		)
		self.assertEqual(patch_resp.status_code, 200)
		self.assertEqual(patch_resp.data["rate"], "0.0820")

		delete_resp = self.client.delete(f"/api/v1/auth/vat-rates/{rate_id}/")
		self.assertEqual(delete_resp.status_code, 204)
		self.assertFalse(VatRate.objects.filter(pk=rate_id).exists())

	def test_non_admin_cannot_manage_vat_rates(self):
		self._auth(self.client, self.owner)

		list_resp = self.client.get("/api/v1/auth/vat-rates/")
		self.assertEqual(list_resp.status_code, 403)

		create_resp = self.client.post(
			"/api/v1/auth/vat-rates/",
			{"rate": "0.0810", "valid_from": "2026-01-01", "valid_to": None},
			format="json",
		)
		self.assertEqual(create_resp.status_code, 403)

	def test_vat_rate_ranges_cannot_overlap(self):
		self._auth(self.client, self.admin)
		VatRate.objects.create(rate="0.0770", valid_from=date(2024, 1, 1), valid_to=date(2025, 12, 31))

		resp = self.client.post(
			"/api/v1/auth/vat-rates/",
			{"rate": "0.0810", "valid_from": "2025-12-01", "valid_to": "2026-12-31"},
			format="json",
		)

		self.assertEqual(resp.status_code, 400)
		self.assertIn("overlap", str(resp.data).lower())

	def test_vat_rate_valid_to_must_be_after_valid_from(self):
		self._auth(self.client, self.admin)

		resp = self.client.post(
			"/api/v1/auth/vat-rates/",
			{"rate": "0.0810", "valid_from": "2026-02-01", "valid_to": "2026-01-01"},
			format="json",
		)

		self.assertEqual(resp.status_code, 400)
		self.assertIn("valid_to", resp.data)


class OAuthProviderConfigTests(TestCase):
	def test_malformed_provider_endpoints_are_refused(self):
		from .serializers import OAuthProviderSerializer

		for url in ("https://idp.example:bad/data", "https://idp.example:65536/data", "https://[broken/data", "https://@/data"):
			with self.subTest(url=url):
				serializer = OAuthProviderSerializer(data={"token_url": url}, partial=True)
				self.assertFalse(serializer.is_valid())
				self.assertIn("token_url", serializer.errors)

	@override_settings(DEBUG=False)
	def test_production_token_and_userinfo_urls_require_https(self):
		from .serializers import OAuthProviderSerializer

		for field in ("token_url", "userinfo_url"):
			with self.subTest(field=field):
				serializer = OAuthProviderSerializer(data={field: "http://idp.example/endpoint"}, partial=True)
				self.assertFalse(serializer.is_valid())
				self.assertIn(field, serializer.errors)

	def _auth(self, client, user, password="pass1234"):
		_cookie_auth(client, user.username, password)

	def setUp(self):
		self.client = APIClient()
		self.admin = User.objects.create_user(username="admin_oauth", password="pass1234", role=UserRole.ADMIN)
		self.owner = User.objects.create_user(username="owner_oauth", password="pass1234", role=UserRole.USER)

	@override_settings(DEBUG=True)
	def test_admin_can_create_provider_with_internal_host_urls(self):
		self._auth(self.client, self.admin)

		resp = self.client.post(
			"/api/v1/auth/oauth/providers/config/",
			{
				"name": "Keycloak Internal",
				"display_name": "Keycloak",
				"client_id": "openzev",
				"client_secret": "secret",
				"authorization_url": "http://keycloak:8080/realms/openzev/protocol/openid-connect/auth",
				"token_url": "http://keycloak:8080/realms/openzev/protocol/openid-connect/token",
				"userinfo_url": "http://keycloak:8080/realms/openzev/protocol/openid-connect/userinfo",
				"redirect_url": "https://app.example.com/api/v1/auth/oauth/callback/keycloak-internal/",
				"scope": "openid email profile",
				"enabled": True,
			},
			format="json",
		)

		self.assertEqual(resp.status_code, 201)
		self.assertEqual(resp.data["name"], "keycloak-internal")

	@override_settings(DEBUG=True)
	def test_admin_can_create_provider_without_scheme(self):
		self._auth(self.client, self.admin)

		resp = self.client.post(
			"/api/v1/auth/oauth/providers/config/",
			{
				"name": "GitHub",
				"display_name": "GitHub",
				"client_id": "openzev",
				"client_secret": "secret",
				"authorization_url": "github.com/login/oauth/authorize",
				"token_url": "github.com/login/oauth/access_token",
				"userinfo_url": "api.github.com/user",
				"redirect_url": "app.example.com/api/v1/auth/oauth/callback/github/",
				"scope": "read:user user:email",
				"enabled": True,
			},
			format="json",
		)

		self.assertEqual(resp.status_code, 201)
		self.assertEqual(resp.data["authorization_url"], "https://github.com/login/oauth/authorize")
		self.assertEqual(resp.data["redirect_url"], "https://app.example.com/api/v1/auth/oauth/callback/github/")

	def test_non_admin_cannot_create_provider(self):
		self._auth(self.client, self.owner)

		resp = self.client.post(
			"/api/v1/auth/oauth/providers/config/",
			{
				"name": "github",
				"display_name": "GitHub",
				"client_id": "openzev",
				"client_secret": "secret",
				"authorization_url": "https://github.com/login/oauth/authorize",
				"token_url": "https://github.com/login/oauth/access_token",
				"userinfo_url": "https://api.github.com/user",
				"redirect_url": "https://app.example.com/api/v1/auth/oauth/callback/github/",
				"scope": "read:user user:email",
				"enabled": True,
			},
			format="json",
		)

		self.assertEqual(resp.status_code, 403)

	@override_settings(FRONTEND_URL="https://portal.example.com")
	def test_admin_create_provider_without_redirect_url_uses_default(self):
		self._auth(self.client, self.admin)

		resp = self.client.post(
			"/api/v1/auth/oauth/providers/config/",
			{
				"name": "GitHub",
				"display_name": "GitHub",
				"client_id": "openzev",
				"client_secret": "secret",
				"authorization_url": "https://github.com/login/oauth/authorize",
				"token_url": "https://github.com/login/oauth/access_token",
				"userinfo_url": "https://api.github.com/user",
				"scope": "read:user user:email",
				"enabled": True,
			},
			format="json",
		)

		self.assertEqual(resp.status_code, 201)
		self.assertEqual(
			resp.data["redirect_url"],
			"https://portal.example.com/api/v1/auth/oauth/callback/github/",
		)

	def test_login_initiate_uses_provider_redirect_url(self):
		provider = OAuthProvider.objects.create(
			name="github",
			display_name="GitHub",
			client_id="client-id",
			client_secret="secret",
			authorization_url="https://github.com/login/oauth/authorize",
			token_url="https://github.com/login/oauth/access_token",
			userinfo_url="https://api.github.com/user",
			redirect_url="https://app.example.com/api/v1/auth/oauth/callback/github/",
			scope="read:user user:email",
			enabled=True,
		)

		resp = self.client.post(f"/api/v1/auth/oauth/login/{provider.name}/")

		self.assertEqual(resp.status_code, 200)
		redirect_url = resp.data["redirect_url"]
		parsed = urlparse(redirect_url)
		params = parse_qs(parsed.query)
		self.assertEqual(
			params["redirect_uri"][0],
			"https://app.example.com/api/v1/auth/oauth/callback/github/",
		)


class OAuthProviderSecretWriteOnlyTests(TestCase):
	"""client_secret is never returned; blank on update keeps the stored secret."""

	def _auth(self, client, user, password="pass1234"):
		_cookie_auth(client, user.username, password)

	def _payload(self, **overrides):
		payload = {
			"name": "github",
			"display_name": "GitHub",
			"client_id": "openzev",
			"client_secret": "super-secret",
			"authorization_url": "https://github.com/login/oauth/authorize",
			"token_url": "https://github.com/login/oauth/access_token",
			"userinfo_url": "https://api.github.com/user",
			"scope": "read:user user:email",
			"enabled": True,
		}
		payload.update(overrides)
		return payload

	def setUp(self):
		self.client = APIClient()
		self.admin = User.objects.create_user(username="oauth_writeonly", password="pass1234", role=UserRole.ADMIN)
		self._auth(self.client, self.admin)

	def test_create_response_never_contains_the_secret(self):
		resp = self.client.post("/api/v1/auth/oauth/providers/config/", self._payload(), format="json")

		self.assertEqual(resp.status_code, 201)
		self.assertNotIn("client_secret", resp.data)
		self.assertTrue(resp.data["has_client_secret"])

	def test_list_and_detail_never_contain_the_secret(self):
		provider = OAuthProvider.objects.create(
			name="github",
			display_name="GitHub",
			client_id="openzev",
			client_secret="super-secret",
			authorization_url="https://github.com/login/oauth/authorize",
			token_url="https://github.com/login/oauth/access_token",
			userinfo_url="https://api.github.com/user",
			scope="read:user user:email",
			enabled=True,
		)

		list_resp = self.client.get("/api/v1/auth/oauth/providers/config/")
		detail_resp = self.client.get(f"/api/v1/auth/oauth/providers/config/{provider.pk}/")

		self.assertNotIn("client_secret", list_resp.data["results"][0])
		self.assertTrue(list_resp.data["results"][0]["has_client_secret"])
		self.assertNotIn("client_secret", detail_resp.data)
		self.assertTrue(detail_resp.data["has_client_secret"])

	def test_create_without_a_secret_is_refused(self):
		resp = self.client.post(
			"/api/v1/auth/oauth/providers/config/",
			self._payload(client_secret=""),
			format="json",
		)

		self.assertEqual(resp.status_code, 400)
		self.assertIn("client_secret", resp.data)
		self.assertFalse(OAuthProvider.objects.filter(name="github").exists())

	def test_blank_secret_on_update_keeps_the_stored_secret(self):
		provider = OAuthProvider.objects.create(
			name="github",
			display_name="GitHub",
			client_id="openzev",
			client_secret="super-secret",
			authorization_url="https://github.com/login/oauth/authorize",
			token_url="https://github.com/login/oauth/access_token",
			userinfo_url="https://api.github.com/user",
			scope="read:user user:email",
			enabled=True,
		)

		resp = self.client.patch(
			f"/api/v1/auth/oauth/providers/config/{provider.pk}/",
			{"client_secret": "", "display_name": "GitHub Login"},
			format="json",
		)

		self.assertEqual(resp.status_code, 200)
		self.assertTrue(resp.data["has_client_secret"])
		provider.refresh_from_db()
		self.assertEqual(provider.client_secret, "super-secret")

	def test_new_secret_on_update_rotates_the_stored_secret(self):
		provider = OAuthProvider.objects.create(
			name="github",
			display_name="GitHub",
			client_id="openzev",
			client_secret="old-secret",
			authorization_url="https://github.com/login/oauth/authorize",
			token_url="https://github.com/login/oauth/access_token",
			userinfo_url="https://api.github.com/user",
			scope="read:user user:email",
			enabled=True,
		)

		resp = self.client.patch(
			f"/api/v1/auth/oauth/providers/config/{provider.pk}/",
			{"client_secret": "rotated-secret"},
			format="json",
		)

		self.assertEqual(resp.status_code, 200)
		self.assertTrue(resp.data["has_client_secret"])
		provider.refresh_from_db()
		self.assertEqual(provider.client_secret, "rotated-secret")

class UserListCreateAdminOnlyTests(TestCase):
	"""The user list used to hand every ZEV owner every active participant
	account in the instance; listing and creating are admin-only."""

	def setUp(self):
		self.admin = User.objects.create_user(username="ul_admin", password="pass1234", role=UserRole.ADMIN)
		self.owner = User.objects.create_user(username="ul_owner", password="pass1234", role=UserRole.USER)
		self.participant_user = User.objects.create_user(username="ul_participant", password="pass1234", role=UserRole.USER)

		self.admin_client = APIClient()
		_cookie_auth(self.admin_client, "ul_admin")
		self.owner_client = APIClient()
		_cookie_auth(self.owner_client, "ul_owner")
		self.participant_client = APIClient()
		_cookie_auth(self.participant_client, "ul_participant")

	def test_owner_cannot_list_users(self):
		response = self.owner_client.get("/api/v1/auth/users/")
		self.assertEqual(response.status_code, 403)

	def test_participant_cannot_list_users(self):
		response = self.participant_client.get("/api/v1/auth/users/")
		self.assertEqual(response.status_code, 403)

	def test_anonymous_cannot_list_users(self):
		response = APIClient().get("/api/v1/auth/users/")
		self.assertEqual(response.status_code, 401)

	def test_owner_cannot_create_users(self):
		response = self.owner_client.post(
			"/api/v1/auth/users/",
			{"username": "ul_backdoor", "email": "backdoor@example.com", "first_name": "Back",
			 "last_name": "Door", "password": "pass1234", "password2": "pass1234", "role": "user"},
			format="json",
		)
		self.assertEqual(response.status_code, 403)
		self.assertFalse(User.objects.filter(username="ul_backdoor").exists())

	def test_admin_can_list_all_users(self):
		response = self.admin_client.get("/api/v1/auth/users/")
		self.assertEqual(response.status_code, 200)
		usernames = {row["username"] for row in response.json()["results"]}
		self.assertEqual(usernames, {"ul_admin", "ul_owner", "ul_participant"})

	def test_admin_can_create_users(self):
		response = self.admin_client.post(
			"/api/v1/auth/users/",
			{"username": "ul_created", "email": "created@example.com", "first_name": "New",
			 "last_name": "User", "password": "Uniquely-Long-9164!", "password2": "Uniquely-Long-9164!", "role": "user"},
			format="json",
		)
		self.assertEqual(response.status_code, 201, response.content)
		self.assertTrue(User.objects.filter(username="ul_created").exists())


class RbacEndpointMatrixTests(TestCase):
	def _auth(self, client, user, password="pass1234"):
		_cookie_auth(client, user.username, password)

	def setUp(self):
		self.clients = {}

		self.admin = User.objects.create_user(username="rbac_matrix_admin", password="pass1234", role=UserRole.ADMIN)
		self.owner = User.objects.create_user(username="rbac_matrix_owner", password="pass1234", role=UserRole.USER)
		self.participant_user = User.objects.create_user(username="rbac_matrix_participant", password="pass1234", role=UserRole.USER)
		self.guest = User.objects.create_user(username="rbac_matrix_guest", password="pass1234", role=UserRole.USER)

		self.zev = create_managed_zev(name="RBAC Matrix ZEV", owner=self.owner, zev_type="vzev", invoice_prefix="R")
		self.participant = Participant.objects.create(
			zev=self.zev,
			user=self.participant_user,
			first_name="Role",
			last_name="Participant",
			email="role.participant@example.com",
			valid_from=date(2026, 1, 1),
		)
		self.metering_point = MeteringPoint.objects.create(
			zev=self.zev,
			meter_id="RBAC-MP-1",
			meter_type=MeteringPointType.CONSUMPTION,
		)
		MeteringPointAssignment.objects.create(
			metering_point=self.metering_point,
			participant=self.participant,
			valid_from=date(2026, 1, 1),
		)

		for role, user in {
			"admin": self.admin,
			"owner": self.owner,
			"participant": self.participant_user,
			"guest": self.guest,
		}.items():
			client = APIClient()
			self._auth(client, user)
			self.clients[role] = client

	def test_list_endpoint_role_matrix(self):
		matrix = [
			{
				"url": "/api/v1/zev/zevs/",
				"expected": {"admin": 200, "owner": 200, "participant": 403, "guest": 403},
			},
			{
				"url": "/api/v1/zev/participants/",
				"expected": {"admin": 200, "owner": 200, "participant": 403, "guest": 403},
			},
			{
				"url": "/api/v1/zev/metering-points/",
				"expected": {"admin": 200, "owner": 200, "participant": 200, "guest": 200},
			},
			{
				"url": "/api/v1/zev/metering-point-assignments/",
				"expected": {"admin": 200, "owner": 200, "participant": 403, "guest": 403},
			},
			{
				"url": "/api/v1/tariffs/tariffs/",
				"expected": {"admin": 200, "owner": 200, "participant": 403, "guest": 403},
			},
			{
				"url": "/api/v1/metering/readings/",
				"expected": {"admin": 200, "owner": 200, "participant": 403, "guest": 403},
			},
			{
				"url": "/api/v1/invoices/invoices/",
				"expected": {"admin": 200, "owner": 200, "participant": 200, "guest": 200},
			},
		]

		for case in matrix:
			for role, client in self.clients.items():
				with self.subTest(url=case["url"], role=role):
					resp = client.get(case["url"])
					self.assertEqual(resp.status_code, case["expected"][role])

	def test_invoice_dashboard_is_admin_only(self):
		expected = {
			"admin": 200,
			"owner": 403,
			"participant": 403,
			"guest": 403,
		}

		for role, client in self.clients.items():
			with self.subTest(role=role):
				resp = client.get("/api/v1/invoices/invoices/dashboard/")
				self.assertEqual(resp.status_code, expected[role])

	def test_create_endpoint_role_matrix(self):
		create_cases = [
			{
				"url": "/api/v1/zev/zevs/",
				"payload": {
					"name": "RBAC Created ZEV",
					"start_date": "2026-01-01",
					"zev_type": "vzev",
					"billing_interval": "monthly",
					"owner": self.owner.id,
				},
				"expected": {"admin": 201, "owner": 403, "participant": 403, "guest": 403},
			},
			{
				"url": "/api/v1/zev/metering-points/",
				"payload": {
					"zev": str(self.zev.id),
					"meter_id": "RBAC-MP-CREATE",
					"meter_type": MeteringPointType.CONSUMPTION,
					"is_active": True,
				},
				"expected": {"admin": 201, "owner": 201, "participant": 403, "guest": 403},
			},
			{
				"url": "/api/v1/tariffs/tariffs/",
				"payload": {
					"zev": str(self.zev.id),
					"name": "RBAC Tariff",
					"category": "grid_fees",
					"billing_mode": "monthly_fee",
					"fixed_price_chf": "10.00",
					"valid_from": "2026-01-01",
				},
				"expected": {"admin": 201, "owner": 201, "participant": 403, "guest": 403},
			},
		]

		for case in create_cases:
			for role, client in self.clients.items():
				with self.subTest(url=case["url"], role=role):
					payload = dict(case["payload"])
					if case["url"] == "/api/v1/zev/zevs/" and role == "admin":
						payload["name"] = f"RBAC Created ZEV {role}"
					if case["url"] == "/api/v1/zev/metering-points/":
						payload["meter_id"] = f"RBAC-MP-{role}"
					if case["url"] == "/api/v1/tariffs/tariffs/" and role in ("admin", "owner"):
						payload["name"] = f"RBAC Tariff {role}"
					resp = client.post(case["url"], payload, format="json")
					self.assertEqual(resp.status_code, case["expected"][role])

	def test_update_endpoint_role_matrix(self):
		expected = {"admin": 200, "owner": 200, "participant": 403, "guest": 403}

		for role, client in self.clients.items():
			with self.subTest(role=role):
				resp = client.patch(
					f"/api/v1/zev/participants/{self.participant.id}/",
					{"phone": f"+41 79 000 0{len(role)} 00"},
					format="json",
				)
				self.assertEqual(resp.status_code, expected[role])

	def test_action_and_delete_role_matrix(self):
		action_expected = {"admin": 200, "owner": 200, "participant": 403, "guest": 403}
		# The invoice is a draft, which its participant cannot see (#861), so the
		# delete 404s for them exactly as it does for an unrelated guest.
		delete_expected = {"admin": 204, "owner": 204, "participant": 404, "guest": 404}

		for role, client in self.clients.items():
			with self.subTest(role=role, operation="approve"):
				invoice = Invoice.objects.create(
					invoice_number=f"R-{role}-A",
					zev=self.zev,
					participant=self.participant,
					period_start=date(2026, 1, 1),
					period_end=date(2026, 1, 31),
					status=InvoiceStatus.DRAFT,
					total_chf="12.00",
				)
				resp = client.post(f"/api/v1/invoices/invoices/{invoice.id}/approve/")
				self.assertEqual(resp.status_code, action_expected[role])

			with self.subTest(role=role, operation="delete"):
				invoice = Invoice.objects.create(
					invoice_number=f"R-{role}-D",
					zev=self.zev,
					participant=self.participant,
					period_start=date(2026, 2, 1),
					period_end=date(2026, 2, 28),
					status=InvoiceStatus.DRAFT,
					total_chf="15.00",
				)
				resp = client.delete(f"/api/v1/invoices/invoices/{invoice.id}/")
				self.assertEqual(resp.status_code, delete_expected[role])

	def test_unauthenticated_matrix_returns_401(self):
		client = APIClient()

		invoice = Invoice.objects.create(
			invoice_number="R-unauth-1",
			zev=self.zev,
			participant=self.participant,
			period_start=date(2026, 3, 1),
			period_end=date(2026, 3, 31),
			status=InvoiceStatus.DRAFT,
			total_chf="20.00",
		)

		cases = [
			("GET", "/api/v1/zev/zevs/", None),
			("GET", "/api/v1/zev/participants/", None),
			("GET", "/api/v1/zev/metering-points/", None),
			("GET", "/api/v1/tariffs/tariffs/", None),
			("GET", "/api/v1/metering/readings/", None),
			("GET", "/api/v1/invoices/invoices/", None),
			("GET", "/api/v1/invoices/invoices/dashboard/", None),
			(
				"POST",
				"/api/v1/zev/metering-points/",
				{
					"zev": str(self.zev.id),
					"meter_id": "RBAC-MP-unauth",
					"meter_type": MeteringPointType.CONSUMPTION,
					"is_active": True,
				},
			),
			("PATCH", f"/api/v1/zev/participants/{self.participant.id}/", {"phone": "+41 79 999 99 99"}),
			("POST", f"/api/v1/invoices/invoices/{invoice.id}/approve/", None),
			("DELETE", f"/api/v1/invoices/invoices/{invoice.id}/", None),
		]

		for method, url, payload in cases:
			with self.subTest(method=method, url=url):
				if method == "GET":
					resp = client.get(url)
				elif method == "POST":
					if payload is None:
						resp = client.post(url)
					else:
						resp = client.post(url, payload, format="json")
				elif method == "PATCH":
					resp = client.patch(url, payload, format="json")
				else:
					resp = client.delete(url)

				self.assertEqual(resp.status_code, 401)


class OAuthTokenCleanupTaskTests(TestCase):
	def test_cleanup_deletes_only_expired_oauth_tokens(self):
		provider = OAuthProvider.objects.create(
			name="cleanup-provider",
			display_name="Cleanup Provider",
			client_id="client-id",
			client_secret="secret",
			authorization_url="https://example.com/oauth/authorize",
			token_url="https://example.com/oauth/token",
			userinfo_url="https://example.com/oauth/userinfo",
			redirect_url="https://app.example.com/api/v1/auth/oauth/callback/cleanup-provider/",
			scope="openid email profile",
			enabled=True,
		)
		user = User.objects.create_user(
			username="oauth-cleanup-user",
			email="oauth-cleanup@example.com",
			password="pass1234",
			role=UserRole.USER,
		)

		expired_state = OAuthState.objects.create(state="expired-state", provider=provider)
		fresh_state = OAuthState.objects.create(state="fresh-state", provider=provider)
		expired_code = OAuthExchangeCode.objects.create(code="expired-code", user=user)
		fresh_code = OAuthExchangeCode.objects.create(code="fresh-code", user=user)

		now = timezone.now()
		OAuthState.objects.filter(pk=expired_state.pk).update(created_at=now - timedelta(minutes=11))
		OAuthState.objects.filter(pk=fresh_state.pk).update(created_at=now - timedelta(minutes=5))
		OAuthExchangeCode.objects.filter(pk=expired_code.pk).update(created_at=now - timedelta(seconds=61))
		OAuthExchangeCode.objects.filter(pk=fresh_code.pk).update(created_at=now - timedelta(seconds=30))

		result = cleanup_expired_oauth_tokens()

		self.assertEqual(result["deleted_states"], 1)
		self.assertEqual(result["deleted_codes"], 1)
		self.assertFalse(OAuthState.objects.filter(pk=expired_state.pk).exists())
		self.assertTrue(OAuthState.objects.filter(pk=fresh_state.pk).exists())
		self.assertFalse(OAuthExchangeCode.objects.filter(pk=expired_code.pk).exists())
		self.assertTrue(OAuthExchangeCode.objects.filter(pk=fresh_code.pk).exists())


class PreferredZevApiTests(TestCase):
	"""``User.preferred_zev`` is the account-level default community: owners and
	admins persist it via ``/auth/me/`` and the response carries it, so the
	frontend's managed-ZEV selection no longer has to depend on name ordering
	(which is database-collation dependent). Only communities the user manages
	are acceptable — for an owner that means their own ZEVs."""

	def setUp(self):
		self.client = APIClient()
		from testing.helpers import authenticate

		self.owner = User.objects.create_user(
			username="pref_owner", password="pass1234", role=UserRole.USER
		)
		self.other_owner = User.objects.create_user(
			username="pref_other_owner", password="pass1234", role=UserRole.USER
		)
		self.admin = User.objects.create_user(
			username="pref_admin", password="pass1234", role=UserRole.ADMIN
		)
		self.participant = User.objects.create_user(
			username="pref_participant", password="pass1234", role=UserRole.USER
		)
		self.zev = create_managed_zev(name="Preferred ZEV", owner=self.owner)
		self.other_zev = create_managed_zev(name="Somebody Else's ZEV", owner=self.other_owner)
		authenticate(self.client, self.owner)

	def _me(self):
		return self.client.get("/api/v1/auth/me/")

	def _set_preferred(self, zev_id):
		return self.client.patch(
			"/api/v1/auth/me/", {"preferred_zev": zev_id}, format="json"
		)

	def test_me_reports_no_preferred_zev_by_default(self):
		resp = self._me()
		self.assertEqual(resp.status_code, 200)
		self.assertIsNone(resp.data["preferred_zev"])

	def test_owner_sets_one_of_their_own_communities(self):
		resp = self._set_preferred(str(self.zev.id))
		self.assertEqual(resp.status_code, 200, resp.content)
		self.assertEqual(resp.data["preferred_zev"], self.zev.id)
		self.owner.refresh_from_db()
		self.assertEqual(self.owner.preferred_zev_id, self.zev.id)

	def test_owner_cannot_prefer_someone_elses_community(self):
		resp = self._set_preferred(str(self.other_zev.id))
		self.assertEqual(resp.status_code, 400)
		self.assertIn("preferred_zev", resp.data)
		self.owner.refresh_from_db()
		self.assertIsNone(self.owner.preferred_zev)

	def test_unknown_zev_is_rejected(self):
		resp = self._set_preferred("00000000-0000-0000-0000-000000000000")
		self.assertEqual(resp.status_code, 400)

	def test_clearing_the_preference_returns_to_first_by_name(self):
		self._set_preferred(str(self.zev.id))
		resp = self._set_preferred(None)
		self.assertEqual(resp.status_code, 200)
		self.assertIsNone(resp.data["preferred_zev"])
		self.owner.refresh_from_db()
		self.assertIsNone(self.owner.preferred_zev)

	def test_participant_cannot_set_a_default_community(self):
		from testing.helpers import authenticate

		authenticate(self.client, self.participant)
		resp = self._set_preferred(str(self.zev.id))
		self.assertEqual(resp.status_code, 400)
		self.assertIn("preferred_zev", resp.data)

	def test_admin_can_prefer_any_community(self):
		from testing.helpers import authenticate

		authenticate(self.client, self.admin)
		resp = self._set_preferred(str(self.other_zev.id))
		self.assertEqual(resp.status_code, 200, resp.content)
		self.admin.refresh_from_db()
		self.assertEqual(self.admin.preferred_zev_id, self.other_zev.id)
