"""Differential coverage for the annual report's SQL energy aggregation."""

import random
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from functools import partial
from zoneinfo import ZoneInfo

from django.db.models.functions import TruncMonth
from django.test import TestCase

from accounts.models import UserRole
from allocation.errors import OverlappingAssignmentWindowsError
from allocation.validity import business_tz, period_end_exclusive_dt, period_start_dt
from metering.analytics import owner_dashboard_summary, zev_balance_timeline
from metering.models import MeterReading, ReadingDirection, ReadingResolution
from testing.helpers import make_user
from zev.models import (
    AllocationMode,
    MeteringPoint,
    MeteringPointAssignment,
    MeteringPointType,
    Participant,
)

from .annual_report import _balance, _empty_month, _rate, build_annual_report
from .test_helpers import make_zev

ZURICH = ZoneInfo("Europe/Zurich")
_BALANCE_KEYS = (
    "produced_kwh",
    "consumed_kwh",
    "imported_kwh",
    "exported_kwh",
    "self_consumed_kwh",
    "self_consumption_rate",
    "self_sufficiency_rate",
)


class AnnualReportReferenceTests(TestCase):
    """The optimized report must match the dashboard's per-reading path."""

    def test_report_matches_the_per_reading_reference(self):
        for seed in range(3):
            with self.subTest(seed=seed):
                self._check_seed(seed)

    def test_whole_number_readings_keep_fractional_local_allocation(self):
        owner = make_user("ar_ref_whole_owner", UserRole.USER)
        zev = make_zev(owner, "Whole-number ZEV")
        consumers = [
            Participant.objects.create(
                zev=zev, first_name=first, last_name="Whole",
                email=f"{first.lower()}@example.com", valid_from=date(2023, 1, 1),
            )
            for first in ("Ana", "Ben")
        ]
        producer = Participant.objects.create(
            zev=zev, first_name="Pia", last_name="Whole",
            email="pia-whole@example.com", valid_from=date(2023, 1, 1),
        )
        ts = datetime(2025, 6, 15, 12, 0, tzinfo=ZURICH)
        for key, participant, meter_type, direction, energy in (
            ("ana", consumers[0], MeteringPointType.CONSUMPTION, ReadingDirection.IN, "1"),
            ("ben", consumers[1], MeteringPointType.CONSUMPTION, ReadingDirection.IN, "1"),
            ("producer", producer, MeteringPointType.PRODUCTION, ReadingDirection.OUT, "1"),
        ):
            mp = MeteringPoint.objects.create(
                zev=zev, meter_id=f"CH-WHOLE-{key}", meter_type=meter_type,
            )
            MeteringPointAssignment.objects.create(
                metering_point=mp, participant=participant, valid_from=date(2023, 1, 1),
            )
            MeterReading.objects.create(
                metering_point=mp, timestamp=ts, energy_kwh=Decimal(energy),
                direction=direction, resolution=ReadingResolution.FIFTEEN_MIN,
            )

        report = build_annual_report(zev, 2025)
        rows = {row["participant_id"]: row for row in report["participants"]}

        for consumer in consumers:
            with self.subTest(consumer=consumer.first_name):
                row = rows[str(consumer.pk)]
                self.assertEqual(row["from_zev_kwh"], 0.5)
                self.assertEqual(row["from_grid_kwh"], 0.5)
                self.assertEqual(row["self_sufficiency_rate"], 50.0)
        self.assertEqual(report["totals"]["produced_kwh"], 1.0)
        self.assertEqual(report["totals"]["consumed_kwh"], 2.0)
        self.assertEqual(report["totals"]["imported_kwh"], 1.0)
        self.assertEqual(report["totals"]["exported_kwh"], 0.0)

    def test_overlapping_assignments_are_rejected(self):
        owner = make_user("ar_ref_overlap_owner", UserRole.USER)
        zev = make_zev(owner, "Overlap ZEV")
        participants = [
            Participant.objects.create(
                zev=zev, first_name=first, last_name="Overlap",
                email=f"{first.lower()}@example.com", valid_from=date(2023, 1, 1),
            )
            for first in ("Ada", "Ben")
        ]
        mp = MeteringPoint.objects.create(
            zev=zev, meter_id="CH-OVERLAP", meter_type=MeteringPointType.CONSUMPTION,
        )
        MeteringPointAssignment.objects.bulk_create(
            [
                MeteringPointAssignment(
                    metering_point=mp, participant=participants[0],
                    valid_from=date(2025, 1, 1), valid_to=date(2025, 6, 30),
                ),
                MeteringPointAssignment(
                    metering_point=mp, participant=participants[1],
                    valid_from=date(2025, 6, 1), valid_to=date(2025, 12, 31),
                ),
            ]
        )
        MeterReading.objects.create(
            metering_point=mp,
            timestamp=datetime(2025, 6, 15, 12, 0, tzinfo=ZURICH),
            energy_kwh=Decimal("1"),
            direction=ReadingDirection.IN,
            resolution=ReadingResolution.FIFTEEN_MIN,
        )

        with self.assertRaises(OverlappingAssignmentWindowsError):
            build_annual_report(zev, 2025)

    def test_personal_and_community_allocation_at_a_midnight_handover(self):
        owner = make_user("ar_boundary_owner", UserRole.USER)
        zev = make_zev(owner, "Boundary ZEV")
        alice, bob, cara = [
            Participant.objects.create(
                zev=zev, first_name=name, last_name="Boundary",
                valid_from=date(2025, 7, 1) if name == "Cara" else date(2025, 1, 1),
                allocation_weight=Decimal("2" if name == "Cara" else "1"),
            )
            for name in ("Alice", "Bob", "Cara")
        ]
        personal, community, production = [
            MeteringPoint.objects.create(
                zev=zev, meter_id=f"CH-BOUNDARY-{name}", meter_type=meter_type,
            )
            for name, meter_type in (
                ("PERSONAL", MeteringPointType.CONSUMPTION),
                ("COMMUNITY", MeteringPointType.CONSUMPTION),
                ("PV", MeteringPointType.PRODUCTION),
            )
        ]
        for mp, participant, start, end, mode in (
            (personal, alice, date(2025, 1, 1), date(2025, 6, 30), AllocationMode.PERSONAL),
            (personal, bob, date(2025, 7, 1), None, AllocationMode.PERSONAL),
            (community, alice, date(2025, 1, 1), None, AllocationMode.COMMUNITY),
            (production, alice, date(2025, 1, 1), None, AllocationMode.PERSONAL),
        ):
            MeteringPointAssignment.objects.create(
                metering_point=mp, participant=participant, valid_from=start,
                valid_to=end, allocation_mode=mode,
            )
        for ts, energy in (
            (datetime(2025, 6, 30, 23, 45, tzinfo=ZURICH), "4"),
            (datetime(2025, 7, 1, 0, 0, tzinfo=ZURICH), "8"),
        ):
            for mp, direction in ((personal, "in"), (community, "in"), (production, "out")):
                MeterReading.objects.create(
                    metering_point=mp, timestamp=ts, energy_kwh=Decimal(energy), direction=direction,
                )

        report = build_annual_report(zev, 2025)
        self.assertEqual(report["totals"], {
            "consumed_kwh": 24.0, "produced_kwh": 12.0, "imported_kwh": 12.0,
            "exported_kwh": 0.0, "self_consumed_kwh": 12.0,
            "self_consumption_rate": 100.0, "self_sufficiency_rate": 50.0,
        })
        for month, consumed, produced in ((6, 8.0, 4.0), (7, 16.0, 8.0)):
            self.assertEqual(report["months"][month - 1]["consumed_kwh"], consumed)
            self.assertEqual(report["months"][month - 1]["produced_kwh"], produced)
        rows = {row["participant_id"]: row for row in report["participants"]}
        self.assertEqual(set(rows), {str(alice.pk), str(bob.pk), str(cara.pk)})
        for participant, expected in (
            (alice, (8.0, 12.0, 4.0, 4.0)),
            (bob, (12.0, 0.0, 6.0, 6.0)),
            (cara, (4.0, 0.0, 2.0, 2.0)),
        ):
            row = rows[str(participant.pk)]
            self.assertEqual(
                tuple(row[key] for key in ("consumed_kwh", "produced_kwh", "from_zev_kwh", "from_grid_kwh")),
                expected,
            )
            self.assertEqual(row["self_sufficiency_rate"], 50.0)

    def test_both_autumn_instants_contribute_to_the_report(self):
        owner = make_user("ar_fold_owner", UserRole.USER)
        zev = make_zev(owner, "Autumn ZEV")
        participant = Participant.objects.create(
            zev=zev, first_name="Alice", last_name="Fold", valid_from=date(2025, 1, 1),
        )
        mp = MeteringPoint.objects.create(zev=zev, meter_id="CH-ANNUAL-FOLD")
        MeteringPointAssignment.objects.create(
            metering_point=mp, participant=participant, valid_from=date(2025, 1, 1),
        )
        for fold, energy in ((0, "2"), (1, "3")):
            MeterReading.objects.create(
                metering_point=mp,
                timestamp=datetime(2025, 10, 26, 2, 15, tzinfo=ZURICH, fold=fold).astimezone(timezone.utc),
                energy_kwh=Decimal(energy),
            )
        report = build_annual_report(zev, 2025)
        self.assertEqual(report["totals"]["consumed_kwh"], 5.0)
        self.assertEqual(report["totals"]["imported_kwh"], 5.0)
        self.assertEqual(report["months"][9]["consumed_kwh"], 5.0)
        self.assertEqual(report["participants"][0]["consumed_kwh"], 5.0)

    def _check_seed(self, seed):
        rng = random.Random(seed)
        owner = make_user(f"ar_ref_owner_{seed}", UserRole.USER)
        zev = make_zev(owner, f"Reference ZEV {seed}")

        participants = self._participants(zev)
        mps = self._metering_points(zev, participants)
        self._readings(mps, rng, year=2025)
        self._readings(mps, rng, year=2024)
        folds = {
            datetime(2025, 10, 26, 2, 15, tzinfo=ZURICH, fold=fold).astimezone(timezone.utc)
            for fold in (0, 1)
        }
        self.assertEqual(
            set(MeterReading.objects.filter(metering_point__zev=zev, timestamp__in=folds)
                .values_list("timestamp", flat=True)),
            folds,
        )

        report = build_annual_report(zev, 2025)
        trunc = partial(TruncMonth, tzinfo=business_tz())
        current_qs = self._year_readings(zev, 2025)
        summary = owner_dashboard_summary(current_qs, trunc, None)

        self.assertTrue(report["has_data"])
        self.assertEqual(
            report["has_behind_meter_generation"],
            summary["zev_has_behind_meter_generation"],
        )
        self._assert_balance(report["totals"], _balance(summary["zev_totals"]))

        timeline = {int(entry["bucket"][5:7]): entry for entry in summary["timeline"]}
        for month in range(1, 13):
            with self.subTest(month=month):
                expected = _balance(timeline.get(month, _empty_month()))
                actual = report["months"][month - 1]
                self.assertEqual(actual["month"], month)
                self._assert_balance(actual, expected)

        expected_rows = {row["participant_id"]: row for row in summary["participant_stats"]}
        actual_rows = {row["participant_id"]: row for row in report["participants"]}
        self.assertEqual(set(actual_rows), set(expected_rows))
        for pid, expected in expected_rows.items():
            with self.subTest(participant=pid):
                actual = actual_rows[pid]
                self.assertAlmostEqual(actual["consumed_kwh"], expected["total_consumed_kwh"], places=6)
                self.assertAlmostEqual(actual["produced_kwh"], expected["total_produced_kwh"], places=6)
                self.assertAlmostEqual(actual["from_zev_kwh"], expected["from_zev_kwh"], places=6)
                self.assertAlmostEqual(actual["from_grid_kwh"], expected["from_grid_kwh"], places=6)
                self.assertEqual(
                    actual["has_behind_meter_generation"],
                    expected["has_behind_meter_generation"],
                )
                if expected["has_behind_meter_generation"]:
                    self.assertIsNone(actual["self_sufficiency_rate"])
                else:
                    self.assertEqual(
                        actual["self_sufficiency_rate"],
                        _rate(expected["from_zev_kwh"], expected["total_consumed_kwh"]),
                    )

        previous_qs = self._year_readings(zev, 2024)
        self.assertTrue(previous_qs.exists())
        previous_timeline, previous_totals = zev_balance_timeline(previous_qs, trunc)
        self._assert_balance(report["previous_totals"], _balance(previous_totals))
        previous_by_month = {int(entry["bucket"][5:7]): entry for entry in previous_timeline}
        for month in range(1, 13):
            with self.subTest(previous_month=month):
                prior = (
                    _balance(previous_by_month[month])
                    if month in previous_by_month
                    else None
                )
                actual = report["months"][month - 1]
                self.assertEqual(
                    actual["previous_self_consumption_rate"],
                    prior["self_consumption_rate"] if prior else None,
                )
                self.assertEqual(
                    actual["previous_self_sufficiency_rate"],
                    prior["self_sufficiency_rate"] if prior else None,
                )

        # Dan has only community participation, so a positive row proves the
        # shares ran; gap and unassigned readings stay in totals but not rows.
        dan = next(participant for participant in participants if participant.first_name == "Dan")
        dan_row = actual_rows[str(dan.pk)]
        self.assertGreater(dan_row["consumed_kwh"], 0.0)
        self.assertGreater(dan_row["from_zev_kwh"], 0.0)
        self.assertLess(
            sum(row["consumed_kwh"] for row in report["participants"]),
            report["totals"]["consumed_kwh"],
        )
        self.assertTrue(report["has_behind_meter_generation"])

    def _participants(self, zev):
        specs = (
            ("Ada", "Always", date(2023, 1, 1), None, "1"),
            ("Bob", "Midyear", date(2023, 1, 1), date(2025, 9, 30), "2"),
            ("Cara", "Summer", date(2025, 7, 1), None, "2.5"),
            ("Dan", "Everyyear", date(2024, 1, 1), date(2025, 12, 31), "1"),
            ("Eve", "Outside", date(2026, 1, 1), None, "1"),
        )
        return [
            Participant.objects.create(
                zev=zev,
                first_name=first,
                last_name=last,
                email=f"{first.lower()}-{zev.pk.hex[:6]}@example.com",
                valid_from=valid_from,
                valid_to=valid_to,
                allocation_weight=Decimal(weight),
            )
            for first, last, valid_from, valid_to, weight in specs
        ]

    def _metering_points(self, zev, participants):
        always, midyear, summer, _everyyear, _outside = participants
        mps = {}

        def create(key, meter_type, *, flagged=False):
            mps[key] = MeteringPoint.objects.create(
                zev=zev,
                meter_id=f"CH-REF-{zev.pk.hex[:8]}-{key.upper()}",
                meter_type=meter_type,
                has_behind_meter_generation=flagged,
            )

        def assign(mp, participant, valid_from, valid_to=None, mode=AllocationMode.PERSONAL):
            MeteringPointAssignment.objects.create(
                metering_point=mp,
                participant=participant,
                valid_from=valid_from,
                valid_to=valid_to,
                allocation_mode=mode,
            )

        create("personal_consumption", MeteringPointType.CONSUMPTION)
        assign(mps["personal_consumption"], always, date(2023, 1, 1))

        create("reassigned_consumption", MeteringPointType.CONSUMPTION)
        assign(mps["reassigned_consumption"], always, date(2023, 1, 1), date(2025, 6, 30))
        assign(mps["reassigned_consumption"], summer, date(2025, 7, 1))

        # Community meters: the holder is not attributed personally, the
        # eligible participants share by weight. October-December is a gap.
        create("community_consumption", MeteringPointType.CONSUMPTION)
        assign(
            mps["community_consumption"], always, date(2025, 1, 1), date(2025, 9, 30),
            AllocationMode.COMMUNITY,
        )
        create("community_production", MeteringPointType.PRODUCTION, flagged=True)
        assign(
            mps["community_production"], midyear, date(2025, 1, 1), None,
            AllocationMode.COMMUNITY,
        )

        create("personal_production", MeteringPointType.PRODUCTION)
        assign(mps["personal_production"], always, date(2023, 1, 1))

        # Readings in 2025 fall into a gap: counted in ZEV totals, attributed
        # to nobody.
        create("gap_consumption", MeteringPointType.CONSUMPTION)
        assign(mps["gap_consumption"], always, date(2024, 1, 1), date(2024, 12, 31))

        create("unassigned_consumption", MeteringPointType.CONSUMPTION)

        # Both holders have readings during their assignment, so both are
        # net-metered while they hold it.
        create("flagged_bidirectional", MeteringPointType.BIDIRECTIONAL, flagged=True)
        assign(mps["flagged_bidirectional"], midyear, date(2024, 1, 1), date(2025, 8, 15))
        assign(mps["flagged_bidirectional"], summer, date(2025, 8, 16))
        return mps

    def _readings(self, mps, rng, *, year):
        mandatory, randomized = self._timestamps(rng, year=year)
        # Local datetimes with different folds compare equal; deduplicate UTC instants.
        mandatory = {ts.astimezone(timezone.utc) for ts in mandatory}
        randomized = {ts.astimezone(timezone.utc) for ts in randomized}
        for ts in sorted(mandatory):
            self._add_readings(mps, rng, ts, allow_gap=False)
        for ts in sorted(randomized - mandatory):
            self._add_readings(mps, rng, ts, allow_gap=True)

    def _timestamps(self, rng, *, year):
        if year == 2025:
            mandatory = [
                # Civil-year cutoffs expressed in UTC.
                datetime(2024, 12, 31, 23, 0, tzinfo=ZoneInfo("UTC")),
                datetime(2025, 12, 31, 22, 45, tzinfo=ZoneInfo("UTC")),
                datetime(2025, 12, 31, 23, 0, tzinfo=ZoneInfo("UTC")),
                datetime(2025, 3, 30, 1, 45, tzinfo=ZURICH),
                datetime(2025, 3, 30, 3, 15, tzinfo=ZURICH),
                datetime(2025, 10, 26, 1, 45, tzinfo=ZURICH),
                datetime(2025, 10, 26, 2, 15, tzinfo=ZURICH, fold=0),
                datetime(2025, 10, 26, 2, 15, tzinfo=ZURICH, fold=1),
                datetime(2025, 10, 26, 3, 15, tzinfo=ZURICH),
                # Ada-to-Cara handover and community membership boundaries.
                datetime(2025, 6, 30, 23, 45, tzinfo=ZURICH),
                datetime(2025, 7, 1, 0, 0, tzinfo=ZURICH),
                datetime(2025, 7, 1, 12, 0, tzinfo=ZURICH),
                datetime(2025, 9, 30, 12, 0, tzinfo=ZURICH),
            ]
            randomized = []
            for _ in range(28):
                day = date(2025, 1, 1) + timedelta(days=rng.randrange(365))
                randomized.append(
                    datetime(day.year, day.month, day.day,
                             rng.randrange(24), rng.choice((0, 15, 30, 45)),
                             tzinfo=ZURICH)
                )
        else:
            mandatory = [
                datetime(2024, 12, 31, 22, 45, tzinfo=ZoneInfo("UTC")),
                datetime(2024, 2, 29, 12, 0, tzinfo=ZURICH),
            ]
            randomized = []
            for _ in range(14):
                day = date(2024, 1, 1) + timedelta(days=rng.randrange(366))
                randomized.append(
                    datetime(day.year, day.month, day.day,
                             rng.randrange(24), rng.choice((0, 15, 30, 45)),
                             tzinfo=ZURICH)
                )
        return mandatory, randomized

    def _add_readings(self, mps, rng, ts, *, allow_gap):
        for mp in mps.values():
            if allow_gap and rng.random() < 0.2:
                continue  # data gap, not just an assignment gap
            directions = [ReadingDirection.IN]
            if mp.meter_type in (MeteringPointType.PRODUCTION, MeteringPointType.BIDIRECTIONAL):
                directions = [ReadingDirection.OUT]
            if mp.meter_type == MeteringPointType.BIDIRECTIONAL and rng.random() < 0.5:
                directions.append(ReadingDirection.IN)
            for direction in directions:
                MeterReading.objects.create(
                    metering_point=mp,
                    timestamp=ts,
                    energy_kwh=Decimal(str(round(rng.uniform(0, 6), 4))),
                    direction=direction,
                    resolution=ReadingResolution.FIFTEEN_MIN,
                )

    def _year_readings(self, zev, year):
        return MeterReading.objects.filter(
            metering_point__zev=zev,
            timestamp__gte=period_start_dt(date(year, 1, 1)),
            timestamp__lt=period_end_exclusive_dt(date(year, 12, 31)),
        )

    def _assert_balance(self, actual, expected):
        for key in _BALANCE_KEYS:
            self.assertAlmostEqual(actual[key], expected[key], places=6, msg=key)
