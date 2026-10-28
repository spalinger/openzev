"""Benchmark synthetic SDAT imports on disposable PostgreSQL databases."""

import argparse
from contextlib import contextmanager, nullcontext
import hashlib
import json
import os
from pathlib import Path
import platform
import re
from subprocess import CalledProcessError, Popen, TimeoutExpired, check_output
import sys
import threading
from time import monotonic, sleep
from uuid import uuid4

import django
from django.conf import settings
from django.core.files import File
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, connections, transaction
from django.test.utils import override_settings
from lxml import etree

from accounts.models import User
from metering.benchmark_data import SCENARIOS, history_digest, invoice_snapshot, prepare, verify_outcome
from metering.importers.sdatch_importer import import_sdatch
from metering.locks import lock_billing_inputs
from zev.models import Zev

CONTROL_TIMEOUT = 5
RECOVERY_TIMEOUT = 15


@contextmanager
def database_session(application_name):
    """Bound connection/control queries, including connections opened by the probe."""
    old = connection.settings_dict["OPTIONS"]
    connection.close()
    connection.settings_dict["OPTIONS"] = {
        **old, "connect_timeout": CONTROL_TIMEOUT, "application_name": application_name,
        "options": f"{old.get('options', '')} -c statement_timeout=5000 -c lock_timeout=5000",
    }
    try:
        yield
    finally:
        connection.close()
        connection.settings_dict["OPTIONS"] = old


def set_statement_timeout(seconds):
    with connection.cursor() as cursor:
        cursor.execute("SET statement_timeout = %s", [f"{seconds}s"])


def address_space_limit(memory_mib):
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (memory_mib * 1024**2, memory_mib * 1024**2))


def check_database(confirmation):
    if connection.vendor != "postgresql" or not str(connection.settings_dict["NAME"]).startswith("sdat_benchmark_"):
        raise CommandError("Need a disposable PostgreSQL database named sdat_benchmark_*.")
    if confirmation != connection.settings_dict["NAME"]:
        raise CommandError("--confirm-disposable must match the database name.")
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT current_database(), current_user,
                   rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls,
                   EXISTS (SELECT 1 FROM pg_auth_members WHERE member = pg_roles.oid),
                   EXISTS (SELECT 1 FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'
                           AND NOT starts_with(datname, 'sdat_benchmark_')
                           AND has_database_privilege(current_user, oid, 'CONNECT'))
            FROM pg_roles WHERE rolname = current_user
        """)
        name, role, privileged, memberships, other_databases = cursor.fetchone()
    if (name != confirmation or not role.startswith("sdat_benchmark_")
            or privileged or memberships or other_databases):
        raise CommandError("Role must be sdat_benchmark_*, unprivileged, with no memberships "
                           "or CONNECT access to other application databases.")
    return {"database": name, "role": role,
            "host": connection.settings_dict["HOST"], "port": connection.settings_dict["PORT"]}


def write_json(path, result):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(result, indent=2) + "\n")
    temporary.replace(path)


def checkpoint(result, path, phase):
    result["phase"] = phase
    if path is not None:
        write_json(path, result)


def cgroup_memory():
    try:
        for line in Path("/proc/self/cgroup").read_text().splitlines():
            if line.startswith("0::"):
                directory = Path("/sys/fs/cgroup") / line[3:].lstrip("/")
                values = {name: (directory / name).read_text().strip()
                          for name in ("memory.current", "memory.max", "memory.peak", "memory.events",
                                       "memory.swap.max", "cpu.max") if (directory / name).exists()}
                return values or {"error": "Cgroup v2 metrics unavailable."}
    except OSError as exc:
        return {"error": f"{type(exc).__name__}: {exc}"}
    return {"error": "Cgroup v2 unavailable."}


def peak_rss_kib(pid="self"):
    match = re.search(r"VmHWM:\s+(\d+)", Path(f"/proc/{pid}/status").read_text())
    if match is None:
        raise ValueError("VmHWM is missing from /proc status.")
    return int(match[1])


def record_rss(result, field):
    try:
        result[field] = peak_rss_kib()
    except (OSError, ValueError) as exc:
        result["measurement_error"] = f"{type(exc).__name__}: {exc}"


def application_names(state, scenario):
    prefix = f"{state['application_prefix']}_{scenario}"
    return [f"{prefix}_importer", f"{prefix}_contender"]


def cleanup_backends(state, scenario):
    """Wait for termination of this run's sessions, never other roles or trials."""
    deadline = monotonic() + RECOVERY_TIMEOUT
    terminated = []
    while monotonic() < deadline:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT pid FROM pg_stat_activity
                WHERE datname = current_database() AND usename = current_user
                  AND application_name = ANY(%s) AND pid <> pg_backend_pid()
            """, [application_names(state, scenario)])
            pids = [row[0] for row in cursor.fetchall()]
            if not pids:
                return {"terminated_pids": terminated, "sessions_gone": True}
            for pid in pids:
                if monotonic() >= deadline:
                    break
                cursor.execute("SELECT pg_terminate_backend(%s, %s)", [pid, 1000])
                if cursor.fetchone()[0]:
                    terminated.append(pid)
        sleep(0.02)
    raise TimeoutError("Benchmark database sessions did not terminate within 15 seconds.")


@contextmanager
def diagnose_import(zev, result, state, scenario, timeout):
    """Instrumented trial only: confirm the importer blocks a competing session."""
    ready, attempted = threading.Event(), threading.Event()
    observed = False
    contender, statements = {}, {}
    result.update(contender=contender, writes=[])
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_backend_pid()")
        importer_pid = cursor.fetchone()[0]
    result["importer_backend_pid"] = importer_pid

    def compete():
        try:
            with connection.cursor() as cursor:
                cursor.execute("SET application_name = %s", [application_names(state, scenario)[1]])
                cursor.execute("SET statement_timeout = %s", [f"{CONTROL_TIMEOUT}s"])
            ready.wait()
            if not observed:
                raise RuntimeError("Import billing lock was not observed.")
            with transaction.atomic():
                started = monotonic()
                attempted.set()
                lock_billing_inputs(zev)
                contender["lock_acquisition_seconds"] = monotonic() - started
        except Exception as exc:
            if "observed_wait" in contender and getattr(exc.__cause__, "pgcode", None) in ("55P03", "57014"):
                contender["bounded_wait_expired"] = True
            else:
                contender["error"] = f"{type(exc).__name__}: {exc}"
            attempted.set()
        finally:
            connections.close_all()

    def observe(execute, sql, params, many, context):
        nonlocal observed
        started = monotonic()
        value = execute(sql, params, many, context)
        elapsed = monotonic() - started
        if not observed and "pg_advisory_xact_lock" in sql:
            observed = True
            set_statement_timeout(CONTROL_TIMEOUT)
            ready.set()
            if not attempted.wait(CONTROL_TIMEOUT):
                raise RuntimeError("Competing connection did not attempt the lock.")
            deadline = monotonic() + CONTROL_TIMEOUT
            while monotonic() < deadline and "error" not in contender:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_stat_clear_snapshot()")
                    cursor.execute("""
                        SELECT pid, wait_event_type, wait_event, pg_blocking_pids(pid)
                        FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user
                          AND application_name = %s
                    """, [application_names(state, scenario)[1]])
                    wait = cursor.fetchone()
                if wait and wait[1] == "Lock" and importer_pid in wait[3]:
                    contender.update(backend_pid=wait[0], observed_wait={
                        "wait_event_type": wait[1], "wait_event": wait[2], "blocking_pids": wait[3],
                    })
                    break
                sleep(0.01)
            if "observed_wait" not in contender:
                raise RuntimeError("PostgreSQL did not confirm the competing lock wait.")
            set_statement_timeout(timeout)
        match = re.match(r'\s*(INSERT INTO|UPDATE|DELETE FROM)\s+"([^"]+)"', sql)
        if match:
            summary = statements.setdefault(match.groups(), dict(operation=match[1], table=match[2], statements=0,
                                                                 rows=0, max_rows=0, max_parameters=0, max_sql_chars=0, seconds=0))
            rows = context["cursor"].rowcount
            summary["statements"] += 1
            summary["rows"] += rows
            summary["seconds"] += elapsed
            for name, count in (("rows", rows), ("parameters", len(params or ())), ("sql_chars", len(sql))):
                summary[f"max_{name}"] = max(summary[f"max_{name}"], count)
        return value

    thread = threading.Thread(target=compete, daemon=True)
    try:
        thread.start()
        with connection.execute_wrapper(observe):
            yield
    finally:
        ready.set()
        if thread.ident is not None:
            thread.join(CONTROL_TIMEOUT + 1)
            if thread.is_alive():
                contender["error"] = "Competing operation did not finish."
        result.update(import_lock_observed=observed, writes=list(statements.values()))
        if not observed:
            contender.setdefault("error", "Import billing lock was not observed.")


def measure(state, scenario, memory_mib, timeout, diagnostic=False, result_path=None):
    """A fresh worker checkpoints setup, import completion and verification separately."""
    result = {"scenario": scenario, "trial": "diagnostic" if diagnostic else "capacity", "worker_pid": os.getpid()}
    checkpoint(result, result_path, "setup")
    duration = "instrumented_import_seconds" if diagnostic else "import_seconds"
    try:
        address_space_limit(memory_mib)
        with database_session(application_names(state, scenario)[0]):
            zev, owner = Zev.objects.get(pk=state["zev"]), User.objects.get(pk=state["owner"])
            invoices_before = invoice_snapshot(zev)
            with Path(state["fixtures"][scenario]["path"]).open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != state["fixtures"][scenario]["sha256"]:
                    raise RuntimeError("Fixture SHA-256 mismatch.")
                stream.seek(0)
                with diagnose_import(zev, result, state, scenario, timeout) if diagnostic else nullcontext():
                    set_statement_timeout(timeout)
                    checkpoint(result, result_path, "import")
                    started = monotonic()
                    try:
                        log = import_sdatch(File(stream, name=f"{scenario}.xml.gz"), zev, owner)
                    finally:
                        result[duration] = monotonic() - started
                    record_rss(result, "peak_rss_kib")
                    result.update(import_completed=True, result_status=log.result_status, result_counts=log.result_counts)
                    checkpoint(result, result_path, "post_import")
                    set_statement_timeout(CONTROL_TIMEOUT)
            checkpoint(result, result_path, "verify")
            result["verified"] = verify_outcome(state, scenario, zev, log, invoices_before)
            if diagnostic and result["contender"].get("error"):
                raise RuntimeError(result["contender"]["error"])
            checkpoint(result, result_path, "complete")
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        record_rss(result, "process_peak_rss_kib")
        if result_path is not None:
            write_json(result_path, result)
    return result


def run_worker(state_path, scenario, directory, memory_mib, timeout, diagnostic=False):
    """Bound the entire worker, then settle its database sessions before inspecting history."""
    result_path = directory / f"{scenario}.json"
    if result_path.exists():
        raise CommandError(f"Worker output already exists: {result_path}")
    result = {"scenario": scenario, "phase": "starting", "exit_code": None, "timed_out": False}
    write_json(result_path, result)
    process, before = None, None
    state = None
    started = monotonic()
    result["cgroup_memory_before"] = cgroup_memory()
    try:
        state = json.loads(state_path.read_text())
        before = history_digest()
        command = [sys.executable, str(settings.BASE_DIR / "manage.py"), "benchmark_sdatch",
                   "--confirm-disposable", str(connection.settings_dict["NAME"]), "--worker-state", str(state_path),
                   "--scenario", scenario, "--memory-mib", str(memory_mib), "--timeout", str(timeout), "--output", str(result_path)]
        if diagnostic:
            command.append("--diagnostic")
        with (directory / f"{scenario}.log").open("w") as log:
            process = Popen(command, cwd=settings.BASE_DIR, stdout=log, stderr=log)
            worker_started = monotonic()
            while process.poll() is None:
                try:
                    peak = peak_rss_kib(process.pid)
                    result["sampled_peak_rss_kib"] = max(result.get("sampled_peak_rss_kib", 0), peak)
                except (OSError, ValueError):
                    pass
                if monotonic() - worker_started > timeout:
                    result["timed_out"] = True
                    process.kill()
                    process.wait(timeout=CONTROL_TIMEOUT)
                    break
                sleep(0.05)
        result["exit_code"] = process.returncode
        result["worker_seconds"] = monotonic() - worker_started
        try:
            output = json.loads(result_path.read_text())
            if (not isinstance(output, dict) or output.get("scenario") != scenario or "worker_pid" not in output
                    or (process.returncode == 0 and not output.get("verified"))):
                raise ValueError("Worker result lacks matching scenario or verified outcomes.")
            result.update(output)
        except (OSError, ValueError) as exc:
            result["result_read_error"] = f"{type(exc).__name__}: {exc}"
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        if process is not None:
            result["exit_code"] = process.returncode
    finally:
        try:
            if state is not None:
                result["database_cleanup"] = cleanup_backends(state, scenario)
        except Exception as exc:
            result["cleanup_error"] = f"{type(exc).__name__}: {exc}"
        if (result["exit_code"] != 0 or result.get("result_read_error")) and before is not None:
            try:
                if "cleanup_error" in result:
                    raise RuntimeError("Database cleanup was not confirmed; history outcome is unknown.")
                connection.close()
                result["history_unchanged"] = history_digest() == before
            except Exception as exc:
                result["history_check_error"] = f"{type(exc).__name__}: {exc}"
        result.update(supervisor_seconds=monotonic() - started, cgroup_memory_after=cgroup_memory())
        write_json(result_path, result)
    return result


def git_metadata():
    try:
        return {"sha": check_output(["git", "rev-parse", "HEAD"], cwd=settings.BASE_DIR, text=True, timeout=5).strip(),
                "dirty": bool(check_output(["git", "status", "--porcelain"], cwd=settings.BASE_DIR, text=True, timeout=5).strip())}
    except (OSError, CalledProcessError, TimeoutExpired) as exc:
        return {"sha": None, "dirty": None, "git_error": f"{type(exc).__name__}: {exc}"}


class Command(BaseCommand):
    help = "Benchmark SDAT imports; requires Linux and a fresh disposable sdat_benchmark_* PostgreSQL DB."

    def add_arguments(self, parser):
        parser.add_argument("--meters", type=int, default=10)
        parser.add_argument("--days", type=int, default=30)
        parser.add_argument("--memory-mib", type=int, default=1024, help="Worker address-space guard in MiB; not RSS.")
        parser.add_argument("--timeout", type=int, default=180, help="Whole-worker wall watchdog, including verification.")
        parser.add_argument("--diagnostic", action="store_true", help="Instrument SQL and contention; not ordinary import timing.")
        parser.add_argument("--output", type=Path, required=True)
        parser.add_argument("--confirm-disposable", required=True, help="Exact disposable database name.")
        parser.add_argument("--worker-state", type=Path, help=argparse.SUPPRESS)
        parser.add_argument("--scenario", choices=SCENARIOS, help=argparse.SUPPRESS)

    @override_settings(DEBUG=False)
    def handle(self, *args, **options):
        if sys.platform != "linux":
            raise CommandError("This benchmark requires Linux /proc instrumentation.")
        if options["memory_mib"] < 256 or options["timeout"] < 1:
            raise CommandError("Need at least 256 MiB address space and a positive worker timeout.")
        if bool(options["worker_state"]) != bool(options["scenario"]):
            raise CommandError("Supply --worker-state and --scenario together.")
        if options["worker_state"]:
            output = options["output"]
            result = {"scenario": options["scenario"], "worker_pid": os.getpid(), "phase": "setup"}
            write_json(output, result)
            try:
                state = json.loads(options["worker_state"].read_text())
                with database_session(application_names(state, options["scenario"])[0]):
                    check_database(options["confirm_disposable"])
                result = measure(state, options["scenario"], options["memory_mib"], options["timeout"], options["diagnostic"], output)
            except Exception as exc:
                result["error"] = f"{type(exc).__name__}: {exc}"
                write_json(output, result)
            if result.get("error") or result.get("measurement_error"):
                raise CommandError("Benchmark worker failed; see its JSON result.")
            return
        if not 2 <= options["meters"] <= 1000 or not 1 <= options["days"] <= 30:
            raise CommandError("Use 2–1000 meters and 1–30 days.")
        directory = options["output"].resolve()
        if directory.exists():
            raise CommandError("Output directory must not already exist.")
        directory.mkdir(parents=True)
        prefix = f"sdat_bench_{uuid4().hex[:12]}"
        report = {"phase": "setup", "trial": "diagnostic" if options["diagnostic"] else "capacity", "results": [],
                  "meters": options["meters"], "days": options["days"], "worker_address_space_mib": options["memory_mib"],
                  "wall_timeout_seconds": options["timeout"], "application_prefix": prefix}
        report_path = directory / "report.json"
        write_json(report_path, report)
        try:
            with database_session(f"{prefix}_parent"):
                report["database_target"] = check_database(options["confirm_disposable"])
                self.stdout.write(f"Disposable database target: {json.dumps(report['database_target'])}")
                report.update(git_metadata(), python=sys.version, django=django.get_version(), lxml=etree.LXML_VERSION,
                              libxml2=etree.LIBXML_VERSION, platform=platform.platform(), cpu_count=os.cpu_count(), django_debug=settings.DEBUG,
                              harness_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                              fixture_code_sha256=hashlib.sha256((settings.BASE_DIR / "metering/benchmark_data.py").read_bytes()).hexdigest(),
                              importer_sha256=hashlib.sha256((settings.BASE_DIR / "metering/importers/sdatch_importer.py").read_bytes()).hexdigest())
                with connection.cursor() as cursor:
                    cursor.execute("SELECT version()")
                    report["postgres"] = cursor.fetchone()[0]
                checkpoint(report, report_path, "prepare")
                state = prepare(directory, options["meters"], options["days"])
                state["application_prefix"] = prefix
                state_path = directory / "state.json"
                write_json(state_path, state)
                report["fixtures"] = state["fixtures"]
                for scenario in SCENARIOS:
                    checkpoint(report, report_path, scenario)
                    self.stdout.write(f"Running {scenario}...")
                    self.stdout.flush()
                    result = run_worker(state_path, scenario, directory, options["memory_mib"], options["timeout"], options["diagnostic"])
                    report["results"].append(result)
                    write_json(report_path, report)
                    if result["exit_code"] != 0 or any(result.get(key) for key in ("error", "measurement_error", "result_read_error", "cleanup_error")):
                        raise RuntimeError(f"{scenario} failed; see {report_path}")
                checkpoint(report, report_path, "complete")
        except Exception as exc:
            report["error"] = f"{type(exc).__name__}: {exc}"
            write_json(report_path, report)
            raise CommandError(f"Benchmark failed during {report['phase']}; see {report_path}") from exc
        self.stdout.write(f"Evidence: {report_path}")
