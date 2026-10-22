"""Initial bands and their tariff are one write, with normal band validation."""
import pytest
from rest_framework.test import APIClient

from tariffs.models import Tariff, TariffPeriod
from testing import factories
from testing.helpers import authenticate

pytestmark = pytest.mark.django_db


@pytest.fixture
def client_and_payload():
    owner = factories.OwnerFactory()
    zev = factories.ZevFactory(owner=owner)
    client = APIClient()
    authenticate(client, owner)
    return client, {
        "zev": str(zev.pk), "name": "Complete tariff", "category": "energy",
        "billing_mode": "energy", "energy_type": "grid", "valid_from": "2026-01-01",
    }


def test_tariff_and_six_bands_are_created_together(client_and_payload):
    client, payload = client_and_payload
    bands = [
        {"period_type": "band", "label": f"Band {hour}", "time_from": f"{hour:02}:00",
         "time_to": f"{(hour + 4) % 24:02}:00", "price_chf_per_kwh": "0.25"}
        for hour in range(0, 24, 4)
    ]
    response = client.post("/api/v1/tariffs/tariffs/", {**payload, "initial_periods": bands}, format="json")
    assert response.status_code == 201, response.data
    assert len(response.data["periods"]) == 6
    assert "initial_periods" not in response.data
    assert TariffPeriod.objects.filter(tariff_id=response.data["id"]).count() == 6


@pytest.mark.parametrize("bad_band", [
    {"period_type": "flat", "price_chf_per_kwh": "0.30"},
    {"period_type": "band", "percentage": "10", "time_from": "21:00", "time_to": "07:00"},
])
def test_late_band_validation_rolls_back_the_whole_tariff(client_and_payload, bad_band):
    client, payload = client_and_payload
    before = Tariff.objects.count(), TariffPeriod.objects.count()
    bands = [{"period_type": "high", "price_chf_per_kwh": "0.25", "time_from": "07:00", "time_to": "21:00"}, bad_band]
    response = client.post("/api/v1/tariffs/tariffs/", {**payload, "initial_periods": bands}, format="json")
    assert response.status_code == 400, response.data
    assert (Tariff.objects.count(), TariffPeriod.objects.count()) == before


def test_initial_bands_are_not_accepted_on_update(client_and_payload):
    client, payload = client_and_payload
    created = client.post("/api/v1/tariffs/tariffs/", payload, format="json")
    response = client.patch(f'/api/v1/tariffs/tariffs/{created.data["id"]}/', {
        "initial_periods": [{"period_type": "flat", "price_chf_per_kwh": "0.20"}],
    }, format="json")
    assert response.status_code == 400
    assert TariffPeriod.objects.filter(tariff_id=created.data["id"]).count() == 0


@pytest.mark.parametrize("changes", [
    {"billing_mode": "monthly_fee", "fixed_price_chf": "5.00"},
    {"billing_mode": "percentage_of_energy", "initial_percentage": "10"},
])
def test_initial_price_bands_cannot_be_attached_to_other_modes(client_and_payload, changes):
    client, payload = client_and_payload
    response = client.post("/api/v1/tariffs/tariffs/", {
        **payload, **changes, "initial_periods": [{"period_type": "flat", "price_chf_per_kwh": "0.20"}],
    }, format="json")
    assert response.status_code == 400
    assert not Tariff.objects.filter(name=payload["name"]).exists()


def test_empty_initial_bands_are_rejected(client_and_payload):
    client, payload = client_and_payload
    response = client.post("/api/v1/tariffs/tariffs/", {**payload, "initial_periods": []}, format="json")
    assert response.status_code == 400
    assert not Tariff.objects.filter(name=payload["name"]).exists()
