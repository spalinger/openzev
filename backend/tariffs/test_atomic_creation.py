"""Initial bands and their tariff are one write, with normal band validation."""
import pytest
from rest_framework.test import APIClient
from audit.models import AuditEvent
from tariffs.dynamic.models import DynamicTariffSource

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
    events = AuditEvent.objects.filter(action_type="tariff_period.create")
    assert set(events.values_list("target_id", flat=True)) == {band["id"] for band in response.data["periods"]}
    assert all(event.actor_user_id and event.metadata_json["tariff_id"] == response.data["id"] for event in events)


@pytest.mark.parametrize("bad_band", [
    {"period_type": "flat", "price_chf_per_kwh": "0.30"},
    {"period_type": "band", "percentage": "10", "time_from": "21:00", "time_to": "07:00"},
])
def test_parent_dependent_band_errors_leave_no_writes(client_and_payload, bad_band):
    client, payload = client_and_payload
    before = Tariff.objects.count(), TariffPeriod.objects.count()
    bands = [{"period_type": "high", "price_chf_per_kwh": "0.25", "time_from": "07:00", "time_to": "21:00"}, bad_band]
    response = client.post("/api/v1/tariffs/tariffs/", {**payload, "initial_periods": bands}, format="json")
    assert response.status_code == 400, response.data
    errors = response.data["initial_periods"]
    assert errors[0] == {}
    assert len(errors) == 2
    error_field = "period_type" if bad_band["period_type"] == "flat" else "percentage"
    assert error_field in errors[1]
    assert (Tariff.objects.count(), TariffPeriod.objects.count()) == before
    assert not AuditEvent.objects.filter(action_type__in=["tariff.create", "tariff_period.create"]).exists()


def test_all_parent_dependent_band_errors_are_reported_before_writing(client_and_payload, monkeypatch):
    client, payload = client_and_payload
    writes = []
    monkeypatch.setattr(Tariff, "save", lambda *args, **kwargs: writes.append(args))
    response = client.post("/api/v1/tariffs/tariffs/", {
        **payload, "initial_periods": [
            {"period_type": "high", "price_chf_per_kwh": "0.25", "time_from": "07:00", "time_to": "21:00"},
            {"period_type": "band", "percentage": "10", "time_from": "21:00", "time_to": "07:00"},
            {"period_type": "flat", "price_chf_per_kwh": "0.30"},
        ],
    }, format="json")
    assert response.status_code == 400, response.data
    assert response.data["initial_periods"][0] == {}
    assert "percentage" in response.data["initial_periods"][1]
    assert "period_type" in response.data["initial_periods"][2]
    assert writes == []


def test_storage_failure_still_rolls_back_the_tariff_and_earlier_bands(client_and_payload, monkeypatch):
    client, payload = client_and_payload
    save = TariffPeriod.save
    calls = 0

    def fail_second_band(instance, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("Storage failed")
        return save(instance, *args, **kwargs)

    monkeypatch.setattr(TariffPeriod, "save", fail_second_band)
    before = Tariff.objects.count(), TariffPeriod.objects.count()
    with pytest.raises(RuntimeError, match="Storage failed"):
        client.post("/api/v1/tariffs/tariffs/", {
            **payload, "initial_periods": [
                {"period_type": "high", "price_chf_per_kwh": "0.25", "time_from": "07:00", "time_to": "21:00"},
                {"period_type": "low", "price_chf_per_kwh": "0.20", "time_from": "21:00", "time_to": "07:00"},
            ],
        }, format="json")
    assert (Tariff.objects.count(), TariffPeriod.objects.count()) == before
    assert not AuditEvent.objects.filter(action_type__in=["tariff.create", "tariff_period.create"]).exists()


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


def test_dynamic_tariffs_reject_initial_bands(client_and_payload):
    client, payload = client_and_payload
    source = DynamicTariffSource.objects.create(label="Grid", url="https://example.test/prices", query_tariff_type="electricity")
    response = client.post("/api/v1/tariffs/tariffs/", {
        **payload, "dynamic_source": str(source.pk),
        "initial_periods": [{"period_type": "flat", "price_chf_per_kwh": "0.20"}],
    }, format="json")
    assert response.status_code == 400
    assert str(response.data["initial_periods"][0]) == "Initial bands are only supported when creating a static energy tariff."
    assert not Tariff.objects.filter(name=payload["name"]).exists()


def test_nested_parent_and_id_cannot_attach_bands_elsewhere(client_and_payload):
    client, payload = client_and_payload
    other = factories.TariffFactory()
    response = client.post("/api/v1/tariffs/tariffs/", {
        **payload, "initial_periods": [{
            "tariff": str(other.pk), "id": "injected", "unknown": "ignored",
            "period_type": "flat", "price_chf_per_kwh": "0.20",
        }],
    }, format="json")
    assert response.status_code == 201, response.data
    assert not other.periods.exists()
    assert str(response.data["periods"][0]["tariff"]) == response.data["id"]


def test_nested_missing_time_leaves_no_tariff_or_bands(client_and_payload):
    client, payload = client_and_payload
    before = Tariff.objects.count(), TariffPeriod.objects.count()
    response = client.post("/api/v1/tariffs/tariffs/", {
        **payload, "initial_periods": [
            {"period_type": "high", "price_chf_per_kwh": "0.25", "time_from": "07:00", "time_to": "21:00"},
            {"period_type": "low", "price_chf_per_kwh": "0.20", "time_from": "21:00"},
        ],
    }, format="json")
    assert response.status_code == 400
    assert str(response.data["initial_periods"][1]["time_to"][0]) == "A timed band needs both a start and an end time."
    assert (Tariff.objects.count(), TariffPeriod.objects.count()) == before


@pytest.mark.parametrize("timed_months,status", [("1", 400), ("2", 201)])
def test_seasonal_flat_timed_validation_is_atomic(client_and_payload, timed_months, status):
    client, payload = client_and_payload
    before = Tariff.objects.count(), TariffPeriod.objects.count()
    response = client.post("/api/v1/tariffs/tariffs/", {
        **payload, "initial_periods": [
            {"period_type": "flat", "price_chf_per_kwh": "0.20", "months": "1"},
            {"period_type": "band", "price_chf_per_kwh": "0.25", "months": timed_months, "time_from": "00:00", "time_to": "00:00"},
        ],
    }, format="json")
    assert response.status_code == status, response.data
    if status == 400:
        assert (Tariff.objects.count(), TariffPeriod.objects.count()) == before
        assert str(response.data["initial_periods"][1]["period_type"][0]) == (
            "A flat band and a timed band cannot both apply in months 1: the flat "
            "price is used for every hour, so the timed bands would never "
            "apply. Give them different months, or make them all timed."
        )
    else:
        assert len(response.data["periods"]) == 2
