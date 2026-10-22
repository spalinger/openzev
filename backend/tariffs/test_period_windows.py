from datetime import time

import pytest
from rest_framework.test import APIClient

from tariffs.models import TariffPeriod
from testing import factories
from testing.helpers import authenticate

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("period_type", ["high", "low", "band"])
@pytest.mark.parametrize("missing", [("time_from",), ("time_to",), ("time_from", "time_to")])
def test_incomplete_period_window_is_rejected_on_create_and_update(period_type, missing):
    owner = factories.OwnerFactory()
    tariff = factories.TariffFactory(zev=factories.ZevFactory(owner=owner))
    client = APIClient()
    authenticate(client, owner)
    payload = {
        "tariff": str(tariff.pk), "period_type": period_type,
        "price_chf_per_kwh": "0.20", "time_from": "21:00", "time_to": "07:00",
    }
    invalid = {**payload, **dict.fromkeys(missing)}
    response = client.post("/api/v1/tariffs/periods/", invalid, format="json")
    assert response.status_code == 400, response.data
    assert set(missing) <= response.data.keys()
    assert not tariff.periods.exists()

    created = client.post("/api/v1/tariffs/periods/", payload, format="json")
    assert created.status_code == 201, created.data
    url = f'/api/v1/tariffs/periods/{created.data["id"]}/'
    response = client.patch(url, dict.fromkeys(missing), format="json")
    assert response.status_code == 400, response.data
    assert set(missing) <= response.data.keys()
    period = TariffPeriod.objects.get(pk=created.data["id"])
    assert (period.time_from, period.time_to) == (time(21), time(7))
    response = client.patch(url, {"price_chf_per_kwh": "0.25"}, format="json")
    assert response.status_code == 200, response.data


def test_flat_period_needs_no_window():
    from tariffs.serializers import TariffPeriodSerializer

    tariff = factories.TariffFactory()
    serializer = TariffPeriodSerializer(data={
        "tariff": str(tariff.pk), "period_type": "flat", "price_chf_per_kwh": "0.20",
    })
    assert serializer.is_valid(), serializer.errors
