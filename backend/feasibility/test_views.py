"""API-level tests for the stateless feasibility calculator endpoint."""
import pytest

pytestmark = pytest.mark.django_db

URL = "/api/v1/feasibility/calculate/"

TYPICAL_PAYLOAD = {
    "annual_production_kwh": "10000",
    "annual_consumption_kwh": "8000",
    "self_consumption_rate": "0.5",
    "retail_price_chf_per_kwh": "0.32",
    "feed_in_price_chf_per_kwh": "0.09",
    "internal_energy_price_chf_per_kwh": "0.20",
    "annual_opex_chf": "300",
    "capex_chf": "2000",
    "horizon_years": 20,
    "discount_rate": "0.03",
}


class TestFeasibilityCalculateAuth:
    def test_requires_authentication(self, api_client):
        response = api_client.post(URL, TYPICAL_PAYLOAD, format="json")
        assert response.status_code == 401

    def test_any_authenticated_role_can_call_it(self, participant_client):
        # Stateless and not ZEV-scoped: participants, owners and admins can all use it.
        response = participant_client.post(URL, TYPICAL_PAYLOAD, format="json")
        assert response.status_code == 200


class TestFeasibilityCalculateHappyPath:
    def test_returns_hand_computed_scenario(self, owner_client):
        response = owner_client.post(URL, TYPICAL_PAYLOAD, format="json")
        assert response.status_code == 200

        body = response.json()
        assert body["self_consumed_kwh"] == "5000.00"
        assert body["grid_import_kwh"] == "3000.00"
        assert body["grid_export_kwh"] == "5000.00"
        assert body["annual_gross_benefit_chf"] == "1150.00"
        assert body["annual_net_benefit_chf"] == "850.00"
        assert body["consumer_savings_chf"] == "600.00"
        assert body["producer_gain_chf"] == "550.00"
        assert body["roi"] == "0.4250"
        # 300 / (10000*0.23) = 3/23 = 0.130434... -> rounded to the field's decimal_places=4.
        assert body["break_even_self_consumption_rate"] == "0.1304"
        assert len(body["sensitivity"]) == 21
        assert len(body["cashflow_by_year"]) == 21

        assert len(body["price_sensitivity"]) == 21
        assert body["equal_split_price_chf_per_kwh"] == "0.20500"
        assert body["fair_price_range"] == {"low_chf_per_kwh": "0.15000", "high_chf_per_kwh": "0.32000"}

    def test_participants_breakdown_sums_to_aggregate(self, owner_client):
        payload = dict(
            TYPICAL_PAYLOAD,
            participants=[
                {"name": "Producer A", "annual_production_kwh": "6000"},
                {"name": "Producer B", "annual_production_kwh": "4000"},
                {"name": "Consumer C", "annual_consumption_kwh": "5000"},
                {"name": "Consumer D", "annual_consumption_kwh": "3000"},
            ],
        )
        response = owner_client.post(URL, payload, format="json")
        assert response.status_code == 200

        body = response.json()
        assert len(body["participants"]) == 4
        by_name = {p["name"]: p for p in body["participants"]}
        assert by_name["Producer A"]["producer_gain_chf"] == "330.00"
        assert by_name["Producer B"]["producer_gain_chf"] == "220.00"
        assert by_name["Consumer C"]["consumer_savings_chf"] == "375.00"
        assert by_name["Consumer D"]["consumer_savings_chf"] == "225.00"

        total_gain = sum(float(p["producer_gain_chf"]) for p in body["participants"])
        total_savings = sum(float(p["consumer_savings_chf"]) for p in body["participants"])
        assert total_gain == float(body["producer_gain_chf"])
        assert total_savings == float(body["consumer_savings_chf"])

    def test_participants_omitted_defaults_to_empty_list(self, owner_client):
        response = owner_client.post(URL, TYPICAL_PAYLOAD, format="json")
        assert response.status_code == 200
        assert response.json()["participants"] == []

    def test_participant_missing_name_returns_400(self, owner_client):
        payload = dict(TYPICAL_PAYLOAD, participants=[{"annual_production_kwh": "1000"}])
        response = owner_client.post(URL, payload, format="json")
        assert response.status_code == 400

    def test_optional_fields_fall_back_to_swiss_defaults(self, owner_client):
        minimal_payload = {
            "annual_production_kwh": "10000",
            "annual_consumption_kwh": "8000",
            "self_consumption_rate": "0.5",
        }
        response = owner_client.post(URL, minimal_payload, format="json")
        assert response.status_code == 200

        body = response.json()
        # With defaults (retail 0.32, feed_in 0.09) the net unit benefit is 0.23,
        # matching the hand-computed scenario's gross benefit.
        assert body["annual_gross_benefit_chf"] == "1150.00"


class TestFeasibilityCalculateValidation:
    def test_missing_required_field_returns_400(self, owner_client):
        payload = dict(TYPICAL_PAYLOAD)
        del payload["annual_production_kwh"]
        response = owner_client.post(URL, payload, format="json")
        assert response.status_code == 400
        assert "annual_production_kwh" in response.json()

    def test_self_consumption_rate_out_of_range_returns_400(self, owner_client):
        payload = dict(TYPICAL_PAYLOAD, self_consumption_rate="1.5")
        response = owner_client.post(URL, payload, format="json")
        assert response.status_code == 400
        assert "self_consumption_rate" in response.json()

    def test_negative_production_returns_400(self, owner_client):
        payload = dict(TYPICAL_PAYLOAD, annual_production_kwh="-1")
        response = owner_client.post(URL, payload, format="json")
        assert response.status_code == 400
        assert "annual_production_kwh" in response.json()

    def test_horizon_years_zero_returns_400(self, owner_client):
        payload = dict(TYPICAL_PAYLOAD, horizon_years=0)
        response = owner_client.post(URL, payload, format="json")
        assert response.status_code == 400
        assert "horizon_years" in response.json()

    def test_horizon_years_above_max_returns_400(self, owner_client):
        payload = dict(TYPICAL_PAYLOAD, horizon_years=51)
        response = owner_client.post(URL, payload, format="json")
        assert response.status_code == 400
        assert "horizon_years" in response.json()
