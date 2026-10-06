"""Registration cancellation and verification must serialize on the user row."""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep
from unittest.mock import patch

import pytest
from django.core import mail
from django.core.cache import cache
from django.db import connection, connections, transaction
from rest_framework.test import APIClient

from accounts.models import EmailVerificationToken, User, UserRole
from testing.helpers import authenticate, make_user


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("first,second,status,active", [
    ("cancel", "verify", 400, False),
    ("cancel", "register", 201, False),
    ("verify", "cancel", 200, False),
    ("verify", "verify", 400, True),
])
def test_registration_actions_serialize(first, second, status, active):
    if connection.vendor != "postgresql":
        pytest.skip("Requires PostgreSQL row locks and pg_blocking_pids")
    cache.clear()
    user = User.objects.create_user(username="pending", email="pending@example.com", is_active=False)
    admin = make_user("registration_admin", UserRole.ADMIN)
    token = EmailVerificationToken.objects.create(user=user, token="pending-link")
    ready, release, connected = Event(), Event(), Event()
    blocked_pid = []

    def request(action):
        client = APIClient()
        if action == "cancel":
            authenticate(client, admin)
            return client.patch(f"/api/v1/auth/users/{user.pk}/", {"is_active": False}, format="json")
        if action == "verify":
            return client.post("/api/v1/auth/verify-email/", {"token": token.token}, format="json")
        return client.post("/api/v1/auth/register/", {"email": user.email}, format="json")

    def hold_first_action():
        try:
            with transaction.atomic():
                response = request(first)
                assert response.status_code == 200, response.data
                ready.set()
                assert release.wait(10), "First registration transaction was not released"
        finally:
            connections.close_all()

    def attempt_second_action():
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                blocked_pid.append(cursor.fetchone()[0])
            connected.set()
            return request(second).status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        holder = pool.submit(hold_first_action)
        try:
            assert ready.wait(10)
            contender = pool.submit(attempt_second_action)
            assert connected.wait(10)
            deadline = monotonic() + 5
            blocked = False
            while monotonic() < deadline:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT cardinality(pg_blocking_pids(%s))", [blocked_pid[0]])
                    blocked = cursor.fetchone()[0] > 0
                if blocked:
                    break
                sleep(0.01)
            assert blocked, f"{second} did not wait for {first}'s user lock"
        finally:
            release.set()
        holder.result(timeout=10)
        assert contender.result(timeout=10) == status

    user.refresh_from_db()
    assert user.is_active is active
    assert len(mail.outbox) == 0
    if first == "cancel":
        assert not user.email_verification_tokens.exists()
    if first == "verify" and second == "cancel":
        assert user.session_version == 1


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("action", ["cancel", "verify"])
def test_delivery_does_not_reverse_a_completed_transition(action):
    cache.clear()
    user = User.objects.create_user(username="sending", email="sending@example.com", is_active=False)
    old = EmailVerificationToken.objects.create(user=user, token="old-link")
    admin = make_user("send_admin", UserRole.ADMIN)

    def send(account, token):
        assert not connection.in_atomic_block
        assert EmailVerificationToken.objects.filter(pk=token.pk).exists()
        client = APIClient()
        if action == "cancel":
            authenticate(client, admin)
            response = client.patch(f"/api/v1/auth/users/{user.pk}/", {"is_active": False}, format="json")
        else:
            response = client.post("/api/v1/auth/verify-email/", {"token": token.token}, format="json")
        assert response.status_code == 200, response.data

    with patch("accounts.views._send_verification_email", side_effect=send):
        response = APIClient().post("/api/v1/auth/register/", {"email": user.email}, format="json")
    assert response.status_code == 201
    user.refresh_from_db()
    assert user.is_active is (action == "verify")
    assert not EmailVerificationToken.objects.filter(pk=old.pk).exists()
    assert not user.email_verification_tokens.filter(consumed_at__isnull=True).exists()


@pytest.mark.django_db(transaction=True)
def test_late_delivery_cleanup_preserves_a_newer_link():
    cache.clear()
    issued = []

    def send(user, token):
        assert not connection.in_atomic_block
        issued.append(token)
        if len(issued) == 1:
            # The earlier request's lease expired while its SMTP operation was in flight.
            cache.clear()
            response = APIClient().post("/api/v1/auth/register/", {"email": user.email}, format="json")
            assert response.status_code == 201

    with patch("accounts.views._send_verification_email", side_effect=send):
        response = APIClient().post("/api/v1/auth/register/", {"email": "late@example.com"}, format="json")
    assert response.status_code == 201
    assert len(issued) == 2
    assert list(EmailVerificationToken.objects.values_list("pk", flat=True)) == [issued[-1].pk]
    response = APIClient().post("/api/v1/auth/verify-email/", {"token": issued[-1].token}, format="json")
    assert response.status_code == 200
