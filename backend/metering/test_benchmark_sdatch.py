"""Benchmark safety, phase reporting, data verification and real PostgreSQL operation."""

from contextlib import contextmanager, nullcontext
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from django.core.management.base import CommandError

from metering import benchmark_data as data
from metering.management.commands import benchmark_sdatch as b


@pytest.mark.parametrize("vendor,name,confirmation,role,privileged,membership,other_db,allowed", [
    ("postgresql", "openzev", "openzev", "sdat_benchmark_runner", False, False, False, False),
    ("sqlite", "sdat_benchmark_test", "sdat_benchmark_test", "sdat_benchmark_runner", False, False, False, False),
    ("postgresql", "sdat_benchmark_test", None, "sdat_benchmark_runner", False, False, False, False),
    ("postgresql", "sdat_benchmark_test", "sdat_benchmark_wrong", "sdat_benchmark_runner", False, False, False, False),
    ("postgresql", "sdat_benchmark_test", "sdat_benchmark_test", "openzev", False, False, False, False),
    ("postgresql", "sdat_benchmark_test", "sdat_benchmark_test", "sdat_benchmark_runner", True, False, False, False),
    ("postgresql", "sdat_benchmark_test", "sdat_benchmark_test", "sdat_benchmark_runner", False, True, False, False),
    ("postgresql", "sdat_benchmark_test", "sdat_benchmark_test", "sdat_benchmark_runner", False, False, True, False),
    ("postgresql", "sdat_benchmark_test", "sdat_benchmark_test", "sdat_benchmark_runner", False, False, False, True),
])
def test_database_guard(monkeypatch, vendor, name, confirmation, role, privileged, membership, other_db, allowed):
    database = Mock(vendor=vendor, settings_dict={"NAME": name, "HOST": "localhost", "PORT": 5432})
    database.cursor.return_value = nullcontext(Mock(fetchone=Mock(return_value=(name, role, privileged, membership, other_db))))
    monkeypatch.setattr(b, "connection", database)
    if allowed:
        assert b.check_database(confirmation)["database"] == name
    else:
        with pytest.raises(CommandError):
            b.check_database(confirmation)


def test_atomic_result_preserves_previous_json(tmp_path):
    path = tmp_path / "result.json"
    b.write_json(path, {"complete": True})
    temporary = path.with_suffix(".json.tmp")
    destination = Mock(wraps=path, suffix=path.suffix)
    writer = Mock(wraps=temporary)
    destination.with_suffix.return_value = writer

    def interrupted(content):
        temporary.write_text(content[:5])
        raise OSError("Interrupted")

    writer.write_text.side_effect = interrupted
    with pytest.raises(OSError):
        b.write_json(destination, {"complete": False})
    assert json.loads(path.read_text()) == {"complete": True}


@pytest.fixture
def measurement(tmp_path, db, monkeypatch):
    state = data.prepare(tmp_path, 2, 1)
    state["application_prefix"] = "sdat_bench_test"
    monkeypatch.setattr(b, "address_space_limit", Mock())
    monkeypatch.setattr(b, "database_session", lambda name: nullcontext())
    monkeypatch.setattr(b, "set_statement_timeout", Mock())
    monkeypatch.setattr(b, "peak_rss_kib", lambda pid="self": 100)
    return state


def test_capacity_trial_has_no_probe_or_sql_wrapper(measurement, monkeypatch):
    diagnostic = Mock(side_effect=AssertionError("Capacity trial must not install instrumentation"))
    monkeypatch.setattr(b, "diagnose_import", diagnostic)
    for scenario in data.SCENARIOS:
        result = b.measure(measurement, scenario, 1024, 10)
        assert "error" not in result, result
        assert result["phase"] == "complete"
        assert result["import_seconds"] >= 0
        assert result["verified"]["invoice_fields_and_items_unchanged"]
        assert "writes" not in result and "contender" not in result
    diagnostic.assert_not_called()


@pytest.mark.parametrize("mutation", ["delete_invoice", "subtotal", "invoice_item", "provenance"])
def test_verification_detects_corruption(measurement, monkeypatch, mutation):
    importer = b.import_sdatch

    def changed(*args):
        log = importer(*args)
        invoices = data.Invoice.objects.filter(zev_id=measurement["zev"])
        if mutation == "delete_invoice":
            invoices.delete()
        elif mutation == "subtotal":
            invoices.update(subtotal_chf="123.45")
        elif mutation == "invoice_item":
            data.InvoiceItem.objects.create(invoice=invoices.first(), item_type="fee", quantity_kwh=1, unit_price_chf=1, total_chf=1)
        else:
            data.MeterReading.objects.filter(condition="56").update(source_document_id="wrong")
        return log

    monkeypatch.setattr(b, "import_sdatch", changed)
    result = b.measure(measurement, "monthly", 1024, 10)
    assert result["phase"] == "verify"
    assert result["import_completed"] is True
    assert "error" in result and "verified" not in result
    if mutation == "provenance":
        assert "source_document_id: expected monthly-" in result["error"]


@pytest.mark.parametrize("failure", ["limit", "fixture", "import"])
def test_worker_failure_keeps_phase_and_error(measurement, tmp_path, monkeypatch, failure):
    output = tmp_path / "worker.json"
    if failure == "limit":
        monkeypatch.setattr(b, "address_space_limit", Mock(side_effect=ValueError("limit failed")))
    elif failure == "fixture":
        Path(measurement["fixtures"]["monthly"]["path"]).write_bytes(b"changed")
    else:
        monkeypatch.setattr(b, "import_sdatch", Mock(side_effect=RuntimeError("import failed")))
    result = b.measure(measurement, "monthly", 1024, 10, result_path=output)
    assert json.loads(output.read_text()) == result
    assert result["error"]
    assert result["phase"] == ("import" if failure == "import" else "setup")
    assert ("import_seconds" in result) == (failure == "import")


def test_post_commit_checkpoint_precedes_diagnostic_cleanup(measurement, tmp_path, monkeypatch):
    output = tmp_path / "worker.json"

    @contextmanager
    def cleanup_failure(zev, result, *args):
        result["contender"] = {}
        yield
        saved = json.loads(output.read_text())
        assert saved["phase"] == "post_import" and saved["import_completed"]
        assert saved["result_status"] == "accepted" and saved["instrumented_import_seconds"] >= 0
        raise RuntimeError("diagnostic cleanup failed")

    monkeypatch.setattr(b, "diagnose_import", cleanup_failure)
    result = b.measure(measurement, "monthly", 1024, 10, diagnostic=True, result_path=output)
    assert result["phase"] == "post_import" and result["import_completed"]
    assert result["error"] == "RuntimeError: diagnostic cleanup failed"


def test_rss_failure_does_not_mask_import_error(measurement, monkeypatch):
    monkeypatch.setattr(b, "peak_rss_kib", Mock(side_effect=OSError("RSS missing")))
    monkeypatch.setattr(b, "import_sdatch", Mock(side_effect=RuntimeError("import failed")))
    result = b.measure(measurement, "monthly", 1024, 10)
    assert result["error"] == "RuntimeError: import failed"
    assert result["measurement_error"] == "OSError: RSS missing"


@pytest.fixture
def supervisor(tmp_path, monkeypatch):
    state_path = tmp_path / "state.json"
    state_path.write_text(json.dumps({"application_prefix": "sdat_bench_test"}))
    monkeypatch.setattr(b, "connection", Mock(settings_dict={"NAME": "sdat_benchmark_test"}))
    monkeypatch.setattr(b, "history_digest", Mock(return_value="same"))
    monkeypatch.setattr(b, "cleanup_backends", Mock(return_value={"sessions_gone": True}))
    monkeypatch.setattr(b, "cgroup_memory", Mock(return_value={"memory.max": "1024"}))
    return state_path


@pytest.mark.parametrize("payload", ["not json", "[]", '{"scenario":"sparse"}'])
def test_malformed_result_keeps_exit_and_database_outcome(supervisor, tmp_path, monkeypatch, payload):
    process = Mock(pid=123, returncode=-9)
    process.poll.return_value = -9

    def spawn(*args, **kwargs):
        (tmp_path / "monthly.json").write_text(payload)
        return process

    monkeypatch.setattr(b, "Popen", spawn)
    result = b.run_worker(supervisor, "monthly", tmp_path, 1024, 10)
    assert result["exit_code"] == -9 and result["result_read_error"]
    assert result["history_unchanged"] is True
    assert result["database_cleanup"]["sessions_gone"]
    assert result["cgroup_memory_before"] == result["cgroup_memory_after"]


def test_watchdog_retains_partial_verification_checkpoint(supervisor, tmp_path, monkeypatch):
    clock = SimpleNamespace(now=10)
    process = Mock(pid=123, returncode=None)
    process.poll.return_value = None
    process.wait.side_effect = lambda **kwargs: setattr(process, "returncode", -9)

    def spawn(*args, **kwargs):
        (tmp_path / "monthly.json").write_text(json.dumps({"worker_pid": 123, "scenario": "monthly", "phase": "verify", "import_completed": True}))
        return process

    def sample(pid):
        clock.now = 12
        return 321

    monkeypatch.setattr(b, "monotonic", lambda: clock.now)
    monkeypatch.setattr(b, "Popen", spawn)
    monkeypatch.setattr(b, "peak_rss_kib", sample)
    b.history_digest.side_effect = ["before", "after"]
    result = b.run_worker(supervisor, "monthly", tmp_path, 1024, 1)
    process.kill.assert_called_once()
    assert result["timed_out"] and result["exit_code"] == -9
    assert result["phase"] == "verify" and result["import_completed"]
    assert result["sampled_peak_rss_kib"] == 321
    assert result["history_unchanged"] is False


def test_failed_cleanup_does_not_claim_history_equality(supervisor, tmp_path, monkeypatch):
    process = Mock(returncode=-9)
    process.poll.return_value = -9
    monkeypatch.setattr(b, "Popen", Mock(return_value=process))
    b.cleanup_backends.side_effect = TimeoutError("still running")
    result = b.run_worker(supervisor, "monthly", tmp_path, 1024, 1)
    assert result["cleanup_error"] == "TimeoutError: still running"
    assert "history_unchanged" not in result and result["history_check_error"]
    assert b.history_digest.call_count == 1


def test_spawn_failure_is_structured(supervisor, tmp_path, monkeypatch):
    monkeypatch.setattr(b, "Popen", Mock(side_effect=OSError("spawn failed")))
    result = b.run_worker(supervisor, "monthly", tmp_path, 1024, 1)
    assert result["error"] == "OSError: spawn failed" and result["exit_code"] is None
    assert json.loads((tmp_path / "monthly.json").read_text()) == result


def test_stale_output_is_not_reused(supervisor, tmp_path, monkeypatch):
    (tmp_path / "monthly.json").write_text("previous")
    spawn = Mock()
    monkeypatch.setattr(b, "Popen", spawn)
    with pytest.raises(CommandError, match="already exists"):
        b.run_worker(supervisor, "monthly", tmp_path, 1024, 1)
    spawn.assert_not_called()


@pytest.fixture
def parent(monkeypatch):
    monkeypatch.setattr(b, "sys", SimpleNamespace(platform="linux", executable=sys.executable, version=sys.version))
    monkeypatch.setattr(b, "database_session", lambda name: nullcontext())
    monkeypatch.setattr(b, "check_database", Mock(return_value={}))
    monkeypatch.setattr(b, "git_metadata", Mock(return_value={"sha": None, "dirty": None}))
    database = Mock()
    database.cursor.return_value = nullcontext(Mock(fetchone=Mock(return_value=["PostgreSQL"])))
    monkeypatch.setattr(b, "connection", database)
    return dict(worker_state=None, scenario=None, memory_mib=1024, timeout=10, meters=2, days=1,
                diagnostic=False, confirm_disposable="sdat_benchmark_test")


def test_preparation_failure_leaves_initial_report(parent, tmp_path, monkeypatch):
    monkeypatch.setattr(b, "prepare", Mock(side_effect=MemoryError("fixture allocation")))
    limit = Mock()
    monkeypatch.setattr(b, "address_space_limit", limit)
    output = tmp_path / "run"
    with pytest.raises(CommandError, match="prepare"):
        b.Command().handle(**parent, output=output)
    report = json.loads((output / "report.json").read_text())
    assert report["phase"] == "prepare" and report["error"] == "MemoryError: fixture allocation"
    limit.assert_not_called()


@pytest.mark.parametrize("memory,timeout", [(255, 1), (256, 0)])
def test_invalid_bounds_are_rejected(parent, tmp_path, memory, timeout):
    parent.update(memory_mib=memory, timeout=timeout)
    with pytest.raises(CommandError, match="worker timeout"):
        b.Command().handle(**parent, output=tmp_path / "run")


def test_git_metadata_failure_is_optional(monkeypatch):
    monkeypatch.setattr(b, "check_output", Mock(side_effect=FileNotFoundError("git")))
    assert b.git_metadata()["sha"] is None


@pytest.mark.skipif(sys.platform != "linux", reason="Linux address-space guard")
def test_largest_fixture_generation_fits_512_mib(tmp_path):
    script = '''import django, json, resource, sys
from pathlib import Path
django.setup()
from metering.benchmark_data import write_fixtures
resource.setrlimit(resource.RLIMIT_AS, (512*1024**2, 512*1024**2))
fixtures = write_fixtures(Path(sys.argv[1]), 1000, 30)
assert fixtures['monthly']['xml_bytes'] > 100*1024**2
print(json.dumps({name: fixture['xml_bytes'] for name,fixture in fixtures.items()}))
'''
    env = {**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings_test", "PYTHONPATH": str(b.settings.BASE_DIR), "DEBUG": "True"}
    result = subprocess.run([sys.executable, "-c", script, str(tmp_path)], env=env, capture_output=True, text=True, timeout=90)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["replacement"] > 100*1024**2


@pytest.mark.django_db(transaction=True)
@pytest.mark.skipif(sys.platform != "linux", reason="Linux worker RSS")
def test_real_postgres_diagnostic_confirms_blocker(tmp_path, monkeypatch):
    if b.connection.vendor != "postgresql":
        pytest.skip("PostgreSQL required")
    monkeypatch.setattr(b, "address_space_limit", Mock())
    state = data.prepare(tmp_path, 2, 1)
    state["application_prefix"] = "sdat_bench_test"
    for scenario in data.SCENARIOS:
        timeouts = []

        def observe(execute, sql, params, many, context):
            if sql == "SET statement_timeout = %s":
                timeouts.append(params[0])
            return execute(sql, params, many, context)

        with b.connection.execute_wrapper(observe):
            result = b.measure(state, scenario, 1024, 15, diagnostic=True)
        assert timeouts == ["15s", "5s", "15s", "5s"]
        assert "error" not in result, result
        assert "import_seconds" not in result and result["instrumented_import_seconds"] >= 0
        assert result["contender"]["observed_wait"]["blocking_pids"] == [result["importer_backend_pid"]]
        assert result["writes"] and result["verified"]["invoice_fields_and_items_unchanged"]


@pytest.mark.django_db(transaction=True)
def test_cleanup_stops_owned_stalled_backend_only():
    if b.connection.vendor != "postgresql":
        pytest.skip("PostgreSQL required")
    import psycopg2
    state = {"application_prefix": f"sdat_test_{os.getpid()}"}
    params = {key: value for key, value in b.connection.get_connection_params().items()
              if key not in ("cursor_factory", "connection_factory")}
    params.update(connect_timeout=5, application_name=b.application_names(state, "monthly")[0])
    script = '''import json,sys,psycopg2
conn=psycopg2.connect(**json.loads(sys.stdin.read()))
with conn.cursor() as cursor:
 cursor.execute('SELECT pg_backend_pid()')
 print(cursor.fetchone()[0],flush=True)
 cursor.execute('DO $$BEGIN PERFORM pg_sleep(60); END$$')
'''
    process = subprocess.Popen([sys.executable, "-c", script], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        process.stdin.write(json.dumps(params))
        process.stdin.close()
        pid = int(process.stdout.readline())
        with psycopg2.connect(**{**params, "application_name": "sdat_unrelated_control"}) as control:
            with b.database_session("sdat_test_supervisor"):
                outcome = b.cleanup_backends(state, "monthly")
            assert outcome["sessions_gone"] and pid in outcome["terminated_pids"]
            with control.cursor() as cursor:
                cursor.execute("SELECT 1")
                assert cursor.fetchone() == (1,)
        assert process.wait(timeout=5) != 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        process.stdout.close()
        process.stderr.close()


@pytest.mark.parametrize("diagnostic,variable", [(False, "SDAT_BENCHMARK_DATABASE_URL"), (True, "SDAT_BENCHMARK_DIAGNOSTIC_DATABASE_URL")])
@pytest.mark.skipif(sys.platform != "linux", reason="Linux subprocess benchmark")
def test_real_command_smoke(tmp_path, diagnostic, variable):
    url = os.environ.get(variable)
    if not url:
        pytest.skip(f"Set {variable} to a fresh disposable isolated PostgreSQL database")
    from urllib.parse import urlparse
    name = urlparse(url).path.removeprefix("/")
    assert name.startswith("sdat_benchmark_")
    env = {**os.environ, "DATABASE_URL": url, "DEBUG": "True", "DJANGO_SETTINGS_MODULE": "config.settings"}
    manage = [sys.executable, str(b.settings.BASE_DIR / "manage.py")]
    migrated = subprocess.run([*manage, "migrate", "--noinput"], env=env, capture_output=True, text=True, timeout=60)
    assert migrated.returncode == 0, migrated.stderr
    output = tmp_path / "run"
    args = [*manage, "benchmark_sdatch", "--confirm-disposable", name, "--meters", "2", "--days", "1",
            "--timeout", "30", "--output", str(output)]
    if diagnostic:
        args.append("--diagnostic")
    completed = subprocess.run(args, env=env, capture_output=True, text=True, timeout=120)
    assert completed.returncode == 0, completed.stderr + completed.stdout
    report = json.loads((output / "report.json").read_text())
    assert report["phase"] == "complete" and len(report["results"]) == 3
    for result in report["results"]:
        assert result["exit_code"] == 0 and result["database_cleanup"]["sessions_gone"]
        assert result["verified"]["reading_values_and_provenance"]
        assert ("contender" in result) == diagnostic
    assert report["results"][-1]["verified"]["billable"] == 192


@pytest.mark.django_db
def test_fixture_hashes_sizes_and_observation_counts_are_reproducible(tmp_path):
    state = data.prepare(tmp_path, 2, 1)
    repeat = tmp_path / "repeat"
    repeat.mkdir()
    fixtures = data.write_fixtures(repeat, 2, 1)
    for name, fixture in state["fixtures"].items():
        payload = Path(fixture["path"]).read_bytes()
        raw = gzip.decompress(payload)
        assert hashlib.sha256(payload).hexdigest() == fixture["sha256"]
        assert len(raw) == fixture["xml_bytes"]
        assert raw.count(b"<rsm:Observation>") == fixture["observations"]
        assert payload == Path(fixtures[name]["path"]).read_bytes()
