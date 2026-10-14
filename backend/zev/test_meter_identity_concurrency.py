"""Cross-column identities require validation and persistence in one transaction."""

import threading
from unittest import skipUnless

from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection, connections, transaction
from django.test import TransactionTestCase

from testing.helpers import create_managed_zev
from zev.models import MeteringPoint
from zev.serializers import MeteringPointSerializer


@skipUnless(connection.vendor == "postgresql", "requires separate PostgreSQL transactions")
class MeterIdentityConcurrencyTests(TransactionTestCase):
    def test_primary_and_secondary_writes_cannot_both_commit(self):
        zev = create_managed_zev(name="Concurrent identities")
        first = MeteringPoint.objects.create(zev=zev, meter_id="CONCURRENT-A")
        other = create_managed_zev(name="Other concurrent ZEV")
        second = MeteringPoint.objects.create(zev=other, meter_id="CONCURRENT-B")
        ready = threading.Barrier(2)
        outcomes = []

        def write(point_id, field):
            close_old_connections()
            try:
                with transaction.atomic():
                    serializer = MeteringPointSerializer(
                        MeteringPoint.objects.get(pk=point_id),
                        data={field: "CONCURRENT-COLLISION"}, partial=True,
                    )
                    serializer.is_valid(raise_exception=True)
                    ready.wait(timeout=10)
                    serializer.save()
                outcomes.append("committed")
            except ValidationError:
                outcomes.append("rejected")
            except Exception as exc:
                outcomes.append(exc)
            finally:
                connections.close_all()

        workers = [threading.Thread(target=write, args=(first.pk, "meter_id")),
                   threading.Thread(target=write, args=(second.pk, "secondary_meter_id"))]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(15)
        self.assertTrue(all(not worker.is_alive() for worker in workers))
        self.assertCountEqual(outcomes, ["committed", "rejected"])
        count = MeteringPoint.objects.filter(meter_id="CONCURRENT-COLLISION").count()
        count += MeteringPoint.objects.filter(secondary_meter_id="CONCURRENT-COLLISION").count()
        self.assertEqual(count, 1)

    def test_import_locks_configuration_until_its_readings_commit(self):
        from datetime import datetime, timezone
        from time import monotonic, sleep
        from unittest.mock import patch
        from django.core.files.uploadedfile import SimpleUploadedFile
        from metering.importers import sdatch_importer
        from metering.models import MeterReading
        from testing.sdat import CONS_ID, build_e66, quarter_block

        zev = create_managed_zev(name="Import configuration race")
        point = MeteringPoint.objects.create(zev=zev, meter_id=CONS_ID)
        ready = threading.Event()
        outcome = {}

        def change_type():
            close_old_connections()
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    outcome["pid"] = cursor.fetchone()[0]
                candidate = MeteringPoint.objects.get(pk=point.pk)
                ready.set()
                candidate.meter_type = "production"
                candidate.save(update_fields=["meter_type"])
                outcome["saved"] = True
            except ValidationError:
                outcome["rejected"] = True
            except Exception as exc:
                outcome["error"] = exc
            finally:
                connections.close_all()

        worker = threading.Thread(target=change_type)
        apply = sdatch_importer._apply_plan

        def commit(**kwargs):
            worker.start()
            self.assertTrue(ready.wait(10))
            deadline = monotonic() + 10
            while monotonic() < deadline:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid() = ANY(pg_blocking_pids(%s))", [outcome["pid"]])
                    if cursor.fetchone()[0]:
                        break
                sleep(0.01)
            else:
                self.fail(f"Point edit did not wait for import: {outcome}")
            return apply(**kwargs)

        try:
            with patch.object(sdatch_importer, "_apply_plan", side_effect=commit):
                log = sdatch_importer.import_sdatch(SimpleUploadedFile("race.xml", build_e66([
                    quarter_block(CONS_ID, "2025-06-02T22:00:00Z", 1),
                ])), zev, None)
        finally:
            if worker.ident is not None:
                worker.join(15)
        self.assertFalse(worker.is_alive())
        self.assertNotIn("error", outcome)
        self.assertTrue(outcome.get("rejected"), outcome)
        self.assertEqual(log.result_status, "accepted")
        point.refresh_from_db()
        self.assertEqual(point.meter_type, "consumption")
        self.assertTrue(MeterReading.objects.filter(
            metering_point=point, timestamp=datetime(2025, 6, 2, 22, tzinfo=timezone.utc),
        ).exists())

    def test_restore_waits_for_import_before_locking_the_community(self):
        from time import monotonic, sleep
        from unittest.mock import patch

        from django.core.files.uploadedfile import SimpleUploadedFile

        from metering.importers import sdatch_importer
        from metering.models import ImportLog, MeterReading
        from testing.sdat import CONS_ID, build_e66, quarter_block
        from zev.locks import lock_meter_identities
        from zev.models import Zev

        zev = create_managed_zev(name="Import and restore lock order")
        point = MeteringPoint.objects.create(zev=zev, meter_id=CONS_ID)
        ready = threading.Event()
        community_locked = threading.Event()
        outcome = {}

        def restore():
            close_old_connections()
            try:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    outcome["pid"] = cursor.fetchone()[0]
                with transaction.atomic():
                    # Match live restore: identity lock, exclusive ZEV lock,
                    # then the child rows being replaced.
                    lock_meter_identities()
                    ready.set()
                    Zev.objects.select_for_update().get(pk=zev.pk)
                    community_locked.set()
                    restored_point = MeteringPoint.objects.select_for_update().get(pk=point.pk)
                    outcome["committed_log_visible"] = ImportLog.objects.filter(zev=zev).exists()
                    restored_point.location_description = "Restore ran after import"
                    restored_point.save(update_fields=["location_description"])
                outcome["completed"] = True
            except Exception as exc:
                outcome["error"] = exc
            finally:
                connections.close_all()

        worker = threading.Thread(target=restore)
        apply = sdatch_importer._apply_plan

        def commit(**kwargs):
            worker.start()
            self.assertTrue(ready.wait(10))
            deadline = monotonic() + 10
            while monotonic() < deadline:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid() = ANY(pg_blocking_pids(%s))", [outcome["pid"]])
                    if cursor.fetchone()[0]:
                        break
                sleep(0.01)
            else:
                self.fail(f"Restore did not wait for import: {outcome}")
            self.assertFalse(community_locked.is_set(), "Restore locked the ZEV before import committed")
            return apply(**kwargs)

        try:
            with patch.object(sdatch_importer, "_apply_plan", side_effect=commit):
                log = sdatch_importer.import_sdatch(SimpleUploadedFile("restore-race.xml", build_e66([
                    quarter_block(CONS_ID, "2025-06-02T22:00:00Z", 1),
                ])), zev, None)
        finally:
            if worker.ident is not None:
                worker.join(15)

        self.assertFalse(worker.is_alive())
        self.assertNotIn("error", outcome)
        self.assertTrue(outcome.get("completed"), outcome)
        self.assertTrue(outcome.get("committed_log_visible"), outcome)
        self.assertEqual(log.result_status, "accepted")
        self.assertTrue(MeterReading.objects.filter(metering_point=point).exists())
        point.refresh_from_db()
        self.assertEqual(point.location_description, "Restore ran after import")
