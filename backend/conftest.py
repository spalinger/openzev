"""Project-wide pytest fixtures.

These fixtures wrap the factories in :mod:`testing.factories` and the auth
helpers in :mod:`testing.helpers` so pytest-style tests can request a ready-made
object graph or an authenticated client without hand-writing ``setUp`` blocks.

Existing ``django.test.TestCase`` classes continue to work unchanged; these
fixtures are additive and only apply to pytest-style test functions.
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from testing import factories
from testing.helpers import authenticate


@pytest.fixture
def api_client() -> APIClient:
    """An unauthenticated DRF test client."""
    return APIClient()


@pytest.fixture
def admin_user(db):
    return factories.AdminFactory()


@pytest.fixture
def owner_user(db):
    return factories.OwnerFactory()


@pytest.fixture
def participant_user(db):
    return factories.ParticipantUserFactory()


@pytest.fixture
def zev(db, owner_user):
    return factories.ZevFactory(owner=owner_user)


@pytest.fixture
def participant(db, zev):
    return factories.ParticipantFactory(zev=zev)


@pytest.fixture
def admin_client(db, admin_user) -> APIClient:
    client = APIClient()
    authenticate(client, admin_user)
    return client


@pytest.fixture
def owner_client(db, owner_user) -> APIClient:
    client = APIClient()
    authenticate(client, owner_user)
    return client


@pytest.fixture
def participant_client(db, participant_user) -> APIClient:
    client = APIClient()
    authenticate(client, participant_user)
    return client
