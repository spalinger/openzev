"""Synthetic SDAT fixtures and checks for the capacity benchmark."""

from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import gzip
import hashlib
import json
from time import monotonic

from django.core.management.base import CommandError
from django.db import transaction
from django.db.models import Sum

from accounts.models import User
from invoices.models import Invoice, InvoiceItem, InvoiceReadingImpact, InvoiceStatus
from metering.importers.reading_changes import READING_CHANGE_CAP
from metering.models import ImportLog, MeterReading, QuarantinedReading
from testing.helpers import create_managed_zev, make_user
from testing.sdat import ACTIVE_PRODUCT, REACTIVE_PRODUCT, build_block, build_e66, observation
from zev.models import MeteringPoint, MeteringPointAssignment, Participant, Zev

SCENARIOS = ("monthly", "sparse", "replacement")
START = datetime(2025, 5, 31, 22, tzinfo=timezone.utc)
METER_PREFIX = "CH99999"
CREATIONS = {name: datetime(2025, 7, day, 12, tzinfo=timezone.utc) for name, day in zip(SCENARIOS, (1, 2, 3))}
HISTORY_TIMEOUT = 30


def meter_id(index):
    return f"{METER_PREFIX}{index:026d}"


def xml_time(value):
    return value.isoformat().replace("+00:00", "Z")


def energy(index, seq, delta=0):
    return Decimal("0.100") + Decimal(seq % 96) / 1000 + Decimal(index % 10) / 1000 + delta


def digest_rows(querysets):
    """Stream a bounded history scan; SQL deadlines are configured by the caller."""
    deadline = monotonic() + HISTORY_TIMEOUT
    digest = hashlib.sha256()
    for rows in querysets:
        digest.update(rows.model._meta.label.encode())
        with closing(rows.order_by("pk").values_list().iterator(chunk_size=256)) as stream:
            for row in stream:
                if monotonic() > deadline:
                    raise TimeoutError("History scan exceeded 30 seconds.")
                digest.update(json.dumps(row, default=str).encode())
    return digest.hexdigest()


def history_digest():
    return digest_rows(model.objects.all() for model in
                       (MeterReading, QuarantinedReading, Invoice, InvoiceItem, InvoiceReadingImpact))


def invoice_snapshot(zev):
    ids = set(Invoice.objects.filter(zev=zev).values_list("pk", flat=True))
    return ids, digest_rows((Invoice.objects.filter(zev=zev), InvoiceItem.objects.filter(invoice__zev=zev)))


def prepare(directory, meters, days):
    if Zev.objects.exists() or User.objects.exists():
        raise CommandError("Database already has users or communities.")
    with transaction.atomic():
        owner = make_user("sdat_benchmark")
        zev = create_managed_zev(owner=owner, name="Synthetic benchmark", zev_type="vzev", invoice_prefix="BENCH")
        for index in range(meters):
            point = MeteringPoint.objects.create(
                zev=zev, meter_id=meter_id(index), meter_type="production" if index == meters - 1 else "consumption",
            )
            participant = Participant.objects.create(
                zev=zev, first_name="Synthetic", last_name=str(index),
                email=f"benchmark-{index}@example.com", valid_from=date(2025, 1, 1),
            )
            MeteringPointAssignment.objects.create(metering_point=point, participant=participant, valid_from=date(2025, 1, 1))
            Invoice.objects.create(
                invoice_number=f"BENCH-{index}", zev=zev, participant=participant,
                period_start=date(2025, 6, 1), period_end=date(2025, 6, 1) + timedelta(days=days - 1),
                status=InvoiceStatus.SENT, total_chf=Decimal("42.00"),
            )
    return {"zev": str(zev.pk), "owner": str(owner.pk), "meters": meters, "slots_per_meter": days * 96,
            "fixtures": write_fixtures(directory, meters, days)}


def write_fixtures(directory, meters, days):
    """Only one meter block is materialized at a time, including at the largest workload."""
    slots = days * 96
    end = START + timedelta(days=days)
    fixtures = {}
    monthly_total = Decimal(0)
    for scenario in SCENARIOS:
        path = directory / f"{scenario}.xml.gz"
        xml_bytes = 0
        total = Decimal(0)
        envelope = build_e66(["<!-- blocks -->"], status="9" if scenario == "monthly" else "5",
                             creation=xml_time(CREATIONS[scenario]),
                             delivery_id=f"BENCH-{scenario}", report_start=xml_time(START), report_end=xml_time(end))
        prefix, suffix = envelope.split(b"<!-- blocks -->")
        with path.open("wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as stream:
            def emit(payload):
                nonlocal xml_bytes
                stream.write(payload)
                xml_bytes += len(payload)

            emit(prefix)
            for index in range(meters):
                point_type = "ProductionMeteringPoint" if index == meters - 1 else "ConsumptionMeteringPoint"
                if scenario == "sparse":
                    for seq in (2, slots):
                        start = START + timedelta(minutes=15 * (seq - 1))
                        emit(build_block(
                            meter_id(index), observation(1, str(energy(index, seq, 1))), doc=f"sparse-{index}-{seq}",
                            point=point_type, start=xml_time(start), end=xml_time(start + timedelta(minutes=15)),
                        ).encode())
                else:
                    parts = []
                    for seq in range(1, slots + 1):
                        value = energy(index, seq, 2 if scenario == "replacement" else 0)
                        condition = "21" if scenario == "monthly" and seq == 1 else "56" if seq == 2 else None
                        parts.append(observation(seq, str(value), condition))
                        if condition != "21":
                            total += value
                    emit(build_block(meter_id(index), "".join(parts), doc=f"{scenario}-{index}", point=point_type,
                                     start=xml_time(START), end=xml_time(end)).encode())
            if scenario == "monthly":
                emit(build_block(meter_id(meters - 1), "".join(observation(seq, "0.1") for seq in range(1, slots + 1)),
                                 doc="reactive-excluded", point="ProductionMeteringPoint", product=REACTIVE_PRODUCT,
                                 start=xml_time(START), end=xml_time(end)).encode())
            emit(suffix)
        if scenario == "monthly":
            monthly_total = total
        if scenario == "sparse":
            total = monthly_total + 2 * meters
        with path.open("rb") as stream:
            sha = hashlib.file_digest(stream, "sha256").hexdigest()
        fixtures[scenario] = {
            "path": str(path), "sha256": sha, "upload_bytes": path.stat().st_size, "xml_bytes": xml_bytes,
            "sum_kwh": str(total), "interval_start": xml_time(START), "interval_end": xml_time(end),
            "civil_timezone": "Europe/Zurich", "resolution_minutes": 15,
            "observations": (meters + 1) * slots if scenario == "monthly" else meters * (2 if scenario == "sparse" else slots),
            "blocks": meters + 1 if scenario == "monthly" else meters * (2 if scenario == "sparse" else 1),
            "existing_billable_rows": 0 if scenario == "monthly" else meters * (slots - 1),
            "existing_held_rows": 0 if scenario == "monthly" else meters,
            "changed_value_fraction_of_overlap": None if scenario == "monthly" else 1,
            "consumption_meters": meters - 1, "production_meters": 1,
        }
    return fixtures


def verify_readings(state, scenario, zev):
    batches = dict(ImportLog.objects.filter(zev=zev).values_list("source_delivery__delivery_id", "batch_id"))
    fields = ("direction", "energy_kwh", "resolution", "import_source", "import_batch", "source_creation",
              "source_document_id", "source_delivery_id", "business_reason", "condition", "source_product",
              "source_unit", "source_meter_id")
    for model in (MeterReading, QuarantinedReading):
        rows = model.objects.filter(metering_point__zev=zev).values("metering_point__meter_id", "timestamp", *fields)
        with closing(rows.iterator(chunk_size=256)) as stream:
            for row in stream:
                observed = row["metering_point__meter_id"]
                if not observed.startswith(METER_PREFIX):
                    raise RuntimeError(f"Unexpected meter ID: {observed}")
                index = int(observed.removeprefix(METER_PREFIX))
                position = (row["timestamp"] - START) / timedelta(minutes=15)
                seq = int(position) + 1
                held = model is QuarantinedReading
                if not (0 <= index < state["meters"] and position == int(position)
                        and 1 <= seq <= state["slots_per_meter"] and held == (seq == 1 and scenario != "replacement")):
                    raise RuntimeError("Reading slot mismatch.")
                source = "monthly"
                if scenario == "replacement":
                    source = "replacement"
                elif scenario == "sparse" and seq in (2, state["slots_per_meter"]):
                    source = "sparse"
                condition = ""
                if held:
                    condition = "21"
                elif seq == 2 and source != "sparse":
                    condition = "56"
                # Calculate independently of the fixture builder to catch generation mistakes.
                value = Decimal("0.100") + Decimal(seq % 96) / 1000 + Decimal(index % 10) / 1000
                value += {"monthly": 0, "sparse": 1, "replacement": 2}[source]
                document = f"{source}-{index}" + (f"-{seq}" if source == "sparse" else "")
                expected = {
                    "direction": "out" if index == state["meters"] - 1 else "in",
                    "energy_kwh": value, "resolution": "15min", "import_source": "sdatch",
                    "import_batch": batches[f"BENCH-{source}"], "source_creation": CREATIONS[source],
                    "source_document_id": document, "source_delivery_id": f"BENCH-{source}",
                    "business_reason": "E88", "condition": condition, "source_product": ACTIVE_PRODUCT,
                    "source_unit": "KWH", "source_meter_id": observed,
                }
                for field, wanted in expected.items():
                    if row[field] != wanted:
                        raise RuntimeError(f"{observed} at {row['timestamp']}: {field}: expected {wanted}, got {row[field]}")


def verify_outcome(state, scenario, zev, log, invoices_before):
    if log.result_status != "accepted":
        raise RuntimeError(f"Import outcome {log.result_status}: {log.errors}")
    if invoice_snapshot(zev) != invoices_before:
        raise RuntimeError("Invoice identities, fields or items changed.")
    meters, slots = state["meters"], state["slots_per_meter"]
    billable = meters * slots if scenario == "replacement" else meters * (slots - 1)
    held = QuarantinedReading.objects.filter(metering_point__zev=zev).count()
    if MeterReading.objects.filter(metering_point__zev=zev).count() != billable or held != (0 if scenario == "replacement" else meters):
        raise RuntimeError("Reading or quarantine count mismatch.")
    actual = MeterReading.objects.filter(metering_point__zev=zev).aggregate(total=Sum("energy_kwh"))["total"]
    if actual != Decimal(state["fixtures"][scenario]["sum_kwh"]):
        raise RuntimeError("Stored energy sum mismatch.")
    counts = {
        "monthly": {"created": billable, "held": meters, "excluded": slots},
        "sparse": {"overwritten": meters * 2},
        "replacement": {"created": meters, "overwritten": meters * (slots - 1), "promoted": meters},
    }[scenario]
    for name in ("created", "overwritten", "held", "promoted", "excluded", "duplicate",
                 "original_existing", "stale", "rejected", "quarantine_overwritten"):
        if log.result_counts[name] != counts.get(name, 0):
            raise RuntimeError(f"Result counter {name} mismatch.")
    changes = {"monthly": billable, "sparse": meters * 2, "replacement": meters * slots}[scenario]
    truncated = changes > READING_CHANGE_CAP
    if len(log.reading_changes) != min(changes, READING_CHANGE_CAP) or log.result_counts["reading_changes_truncated"] != truncated:
        raise RuntimeError("Reading-change count or truncation flag mismatch.")
    verify_readings(state, scenario, zev)
    impacts = list(InvoiceReadingImpact.objects.filter(import_log=log).values_list("invoice_id", "evidence"))
    if ({invoice for invoice, _ in impacts} != invoices_before[0]
            or any(item["change_count"] != changes or item["changes_truncated"] != truncated for _, item in impacts)):
        raise RuntimeError("Invoice-impact IDs or change totals mismatch.")
    return {"billable": billable, "held": held, "sum_kwh": str(actual), "invoice_impacts": len(impacts),
            "delivery_changes": changes, "reading_values_and_provenance": True, "invoice_fields_and_items_unchanged": True,
            "retained_reading_changes": len(log.reading_changes), "reading_changes_truncated": truncated}
