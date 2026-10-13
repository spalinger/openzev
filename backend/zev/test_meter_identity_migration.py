"""0046 preserves legacy data when alias normalization would collide."""

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from testing.helpers import create_managed_zev, make_user

from zev.models import MeteringPoint

BEFORE = [("zev", "0046_meteringpoint_secondary_meter_id")]
AFTER = [("zev", "0047_meteringpoint_metering_point_secondary_differs_from_primary")]


class MeterIdentityMigrationTests(TransactionTestCase):
    def setUp(self):
        MigrationExecutor(connection).migrate(BEFORE)
        self.zev = create_managed_zev(name="Migration ZEV", owner=make_user("migration-owner"))

    def tearDown(self):
        MeteringPoint.objects.all().delete()
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def point(self, primary, secondary):
        return MeteringPoint.objects.create(zev=self.zev, meter_id=primary, secondary_meter_id=secondary)

    def test_normalization_collision_aborts_without_changing_any_id(self):
        first = self.point("MIG-A", "MIG-ALIAS")
        second = self.point("MIG-B", None)
        blank = self.point("MIG-C", None)
        MeteringPoint.objects.filter(pk=second.pk).update(secondary_meter_id=" MIG-ALIAS ")
        MeteringPoint.objects.filter(pk=blank.pk).update(secondary_meter_id="   ")
        with self.assertRaisesMessage(RuntimeError, "Correct their secondary IDs"):
            MigrationExecutor(connection).migrate(AFTER)
        first.refresh_from_db()
        second.refresh_from_db()
        blank.refresh_from_db()
        self.assertEqual(first.secondary_meter_id, "MIG-ALIAS")
        self.assertEqual(second.secondary_meter_id, " MIG-ALIAS ")
        self.assertEqual(blank.secondary_meter_id, "   ")

    def test_normalizes_blanks_and_redundancy_while_preserving_cross_point_collisions(self):
        redundant = self.point("MIG-SELF", None)
        trimmed = self.point("MIG-TRIM", None)
        blank = self.point("MIG-BLANK", None)
        MeteringPoint.objects.filter(pk=redundant.pk).update(secondary_meter_id="MIG-SELF")
        MeteringPoint.objects.filter(pk=trimmed.pk).update(secondary_meter_id=" MIG-SELF ")
        MeteringPoint.objects.filter(pk=blank.pk).update(secondary_meter_id="   ")
        MigrationExecutor(connection).migrate(AFTER)
        redundant.refresh_from_db()
        trimmed.refresh_from_db()
        blank.refresh_from_db()
        self.assertIsNone(redundant.secondary_meter_id)
        self.assertIsNone(blank.secondary_meter_id)
        self.assertEqual(trimmed.secondary_meter_id, "MIG-SELF")
