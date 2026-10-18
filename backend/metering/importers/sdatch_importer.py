"""
SDAT-CH (ebIX XML) metering data importer.

Parses the Swiss SDAT-CH ``ValidatedMeteredData`` format delivered by VNBs
(SDAT-CH 2025, VSE branch documents; XSDs vendored in ``sdat_xsd/``).

Only E66 (ValidatedMeteredData, per-meter series) is imported. Aggregate
(E31), imbalance and any other root are rejected with a named error — grid
sums must never land on a metering point.

Routing per observation (grill Q4/Q15): billable (BusinessReason E88 with no
Condition or Condition 56) goes to ``MeterReading``; info-only (C38) or
temporary (Condition 21) goes to ``QuarantinedReading``, invisible to
billing, until a billable delivery promotes it (Q16).

Corrections (header Status=5) upsert guarded by InstanceDocument Creation
(Q5/Q12): stale deliveries never clobber fresher data, and non-SDAT rows
are never overwritten.
"""

import gzip
import io
import os
import tempfile
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation

from lxml import etree

from allocation.validity import business_tz

from zev.models import MeteringPoint
from metering.models import (
    ImportLog,
    ImportSource,
    MeterReading,
    QuarantinedReading,
    ReadingDirection,
    ReadingResolution,
)
from metering.importers.limits import MAX_UPLOAD_BYTES, add_error, mb

MAX_SDAT_BYTES = MAX_UPLOAD_BYTES
MAX_SDAT_DECOMPRESSED_BYTES = 100 * 1024 * 1024

SDAT_NS = "http://www.strom.ch"

PRODUCT_WIRKENERGIE = "8716867000030"
PRODUCT_BLINDENERGIE = "8716867000047"
PRODUCT_LEG_ENERGIE = "2404050010123"
PRODUCT_LEG_RESTENERGIE = "2404050010124"

REASON_BILLING = "E88"
CONDITION_TEMPORARY = "21"
CONDITION_ESTIMATED = "56"

RESOLUTION_LABELS = {
    15: ReadingResolution.FIFTEEN_MIN,
    60: ReadingResolution.HOURLY,
}

MAX_ENERGY_KWH = Decimal("99999999.9999")
MAX_GAP_WARNINGS = 10


def _qname(local: str) -> str:
    return f"{{{SDAT_NS}}}{local}"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _text(elem, local: str) -> str:
    child = elem.find(_qname(local))
    if child is None or child.text is None:
        return ""
    return child.text.strip()


def _code(elem, local: str) -> str:
    """Code value of a wrapper element: nested ebIX/VSE code or direct text."""
    if elem is None:
        return ""
    child = elem.find(_qname(local))
    if child is None:
        return ""
    return (
        _text(child, "ebIXCode") or _text(child, "VSENationalCode") or (child.text or "").strip()
    ).strip()


def _sequence(obs) -> str:
    """Position sequence of an observation (nested Position/Sequence)."""
    pos = obs.find(_qname("Position"))
    if pos is not None:
        seq = (pos.findtext(_qname("Sequence")) or "").strip()
        if seq:
            return seq
    return _text(obs, "Sequence")


# ---------------------------------------------------------------------------
# XSD validation (Q9)
# ---------------------------------------------------------------------------

_SCHEMA_16 = None


def _load_schema_16():
    """Compile the vendored ValidatedMeteredData 1.6 schema.

    The official VSE schemas carry ``use="prohibited"`` attributes with a
    child ``simpleType`` (accepted by Xerces-tolerant industry tooling, but
    rejected by libxml2). The vendored files stay pristine; normalized copies
    are compiled from a per-process temp dir. Semantics are unchanged:
    prohibited means the attribute must be absent.
    """
    global _SCHEMA_16
    if _SCHEMA_16 is not None:
        return _SCHEMA_16
    xsd_dir = os.path.join(os.path.dirname(__file__), "sdat_xsd")
    tmpdir = tempfile.mkdtemp(prefix="sdat_xsd_")
    attr_tag = "{http://www.w3.org/2001/XMLSchema}attribute"
    for name in sorted(os.listdir(xsd_dir)):
        if not name.endswith(".xsd"):
            continue
        doc = etree.parse(os.path.join(xsd_dir, name))
        for attr in doc.getroot().iter(attr_tag):
            if attr.get("use") == "prohibited" and len(attr):
                for child in list(attr):
                    attr.remove(child)
        doc.write(os.path.join(tmpdir, name), xml_declaration=True, encoding="UTF-8")
    _SCHEMA_16 = etree.XMLSchema(etree.parse(os.path.join(tmpdir, "ValidatedMeteredData_1p6.xsd")))
    return _SCHEMA_16


def _parse_ts(value: str) -> datetime:
    """Parse an SDAT-CH timestamp to an aware UTC datetime.

    Real files always carry ``Z`` (Anhang 3 §6(2): UTC exclusively). A bare
    timestamp is read as Swiss wall-clock time (ADR 0026) rather than the
    process timezone.
    """
    parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=business_tz())
    return parsed.astimezone(timezone.utc)


def _fail(log, message, *, meter_id=None):
    log.rows_total = 0
    log.rows_imported = 0
    log.rows_skipped = 0
    entry = {"error": message}
    if meter_id:
        entry["meter_id"] = meter_id
    log.errors = [entry]
    log.save()
    return log


def import_sdatch(file, zev, user):
    """
    Import metering readings from a SDAT-CH ValidatedMeteredData XML file.

    Returns an ImportLog instance.
    """
    batch_id = uuid.uuid4()
    filename = getattr(file, "name", "upload.xml")

    log = ImportLog.objects.create(
        batch_id=batch_id,
        zev=zev,
        imported_by=user,
        source=ImportSource.SDATCH,
        filename=filename,
        timestamp_timezone=str(business_tz()),
    )

    # App-level size cap (nginx enforces 413 earlier).
    size_hint = getattr(file, "size", None)
    if size_hint is not None and size_hint > MAX_SDAT_BYTES:
        return _fail(
            log,
            f"File too large ({mb(size_hint)}). Maximum is {mb(MAX_SDAT_BYTES)}.",
        )

    try:
        raw = file.read()
    except Exception as exc:
        return _fail(log, f"Could not read uploaded file: {exc}")

    if filename.lower().endswith(".gz"):
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
                raw = gz.read(MAX_SDAT_DECOMPRESSED_BYTES + 1)
        except Exception as exc:
            return _fail(log, f"Could not decompress gzip file: {exc}")
        if len(raw) > MAX_SDAT_DECOMPRESSED_BYTES:
            return _fail(
                log,
                f"Decompressed file too large. Maximum is {mb(MAX_SDAT_DECOMPRESSED_BYTES)}.",
            )

    try:
        parser = etree.XMLParser(
            resolve_entities=False,
            load_dtd=False,
            no_network=True,
            huge_tree=False,
        )
        root = etree.fromstring(raw, parser)
    except Exception as exc:
        return _fail(log, f"Malformed SDAT-CH XML: {exc}")

    root_name = _local(root.tag)

    # Q1: E66 only. Aggregates, imbalance data and anything else are rejected
    # loudly — never silently imported as meter readings.
    if not root_name.startswith("ValidatedMeteredData_"):
        if root_name.startswith("AggregatedMeteredData_"):
            detail = "AggregatedMeteredData holds grid-area/balance-group sums, not per-meter data."
        elif root_name.startswith("ImbalanceData_"):
            detail = "ImbalanceData holds balance-settlement series, not per-meter data."
        else:
            detail = f"Unsupported root element '{root_name}'."
        return _fail(log, f"Not a ValidatedMeteredData (E66) file. {detail} Nothing was imported.")

    # Q9: strict XSD gate for the current schema version.
    if root_name == "ValidatedMeteredData_16":
        # Cancellation carries its own message even before schema validation
        # (the E66 schema only permits Status 9/5).
        pre_header = root.find(_qname("ValidatedMeteredData_HeaderInformation"))
        pre_instance = pre_header.find(_qname("InstanceDocument")) if pre_header is not None else None
        if pre_instance is not None and _text(pre_instance, "Status") == "1":
            return _fail(log, "Document Status is 1 (cancellation). Cancellations are not imported.")
        try:
            schema = _load_schema_16()
        except Exception as exc:
            return _fail(log, f"Schema validation unavailable: {exc}")
        if not schema.validate(root):
            first = schema.error_log.last_error
            return _fail(log, f"Schema validation failed: {first.message} (line {first.line}).")
    else:
        log.warnings.append(
            {"warning": f"Schema version {root_name} is not bundled; parsed structurally without XSD validation."}
        )

    header = root.find(_qname("ValidatedMeteredData_HeaderInformation"))
    if header is None:
        return _fail(log, "Missing ValidatedMeteredData_HeaderInformation.")

    instance = header.find(_qname("InstanceDocument"))
    doc_type = _code(instance, "DocumentType")
    if "E66" not in doc_type:
        return _fail(log, f"DocumentType is not E66 (ValidatedMeteredData): '{doc_type}'. Nothing was imported.")

    status = _text(instance, "Status") if instance is not None else ""
    if status == "1":
        return _fail(log, "Document Status is 1 (cancellation). Cancellations are not imported.")
    is_replace = status == "5"

    creation_raw = _text(instance, "Creation") if instance is not None else ""
    try:
        creation = _parse_ts(creation_raw) if creation_raw else datetime.now(timezone.utc)
    except Exception:
        return _fail(log, f"Invalid Creation timestamp '{creation_raw}'.")
    if not creation_raw:
        log.warnings.append({"warning": "Missing Creation timestamp; delivery order cannot be verified."})

    scope = header.find(_qname("BusinessScopeProcess"))
    reason = _code(scope, "BusinessReasonType")

    meter_lookup = {}
    for mp in MeteringPoint.objects.filter(zev=zev):
        meter_lookup[mp.meter_id] = mp
        if mp.secondary_meter_id:
            meter_lookup[mp.secondary_meter_id] = mp

    rows_total = 0
    imported = 0
    overwritten = 0
    skipped = 0
    quarantined = 0
    promoted = 0
    errors = []
    warnings = list(log.warnings)
    product_notes = {}
    gap_warnings = 0
    written = set()

    def note_product(product, message):
        if product not in product_notes:
            product_notes[product] = message

    for md in root.iter(_qname("MeteringData")):
        doc_id = _text(md, "DocumentID")

        interval = md.find(_qname("Interval"))
        if interval is None:
            add_error(errors, {"error": f"MeteringData block '{doc_id or '?'}' has no Interval; block skipped."})
            continue
        try:
            start_ts = _parse_ts(_text(interval, "StartDateTime"))
            end_ts = _parse_ts(_text(interval, "EndDateTime"))
        except Exception as exc:
            add_error(errors, {"error": f"Invalid Interval timestamps in block '{doc_id or '?'}': {exc}"})
            continue
        if end_ts <= start_ts:
            add_error(errors, {"error": f"Empty Interval in block '{doc_id or '?'}'; block skipped."})
            continue

        # Q14: resolution must be usable; monthly net-production blocks without
        # one cannot be placed on a timeline.
        res_elem = md.find(_qname("Resolution"))
        res_minutes = None
        if res_elem is not None:
            try:
                res_value = int((_text(res_elem, "Resolution") or "").strip())
            except ValueError:
                res_value = None
            unit = (_text(res_elem, "Unit") or "").strip().upper()
            if res_value is not None and unit == "MIN" and res_value in RESOLUTION_LABELS:
                res_minutes = res_value
        if res_minutes is None:
            add_error(
                errors,
                {"error": f"Block '{doc_id or '?'}' has no usable 15/60-minute Resolution; block skipped."},
            )
            continue
        resolution = RESOLUTION_LABELS[res_minutes]

        point_elem = None
        direction = None
        for local_name, flow in (
            ("ConsumptionMeteringPoint", ReadingDirection.IN),
            ("ProductionMeteringPoint", ReadingDirection.OUT),
        ):
            found = md.find(_qname(local_name))
            if found is not None:
                point_elem = found
                direction = flow
                break
        if point_elem is None:
            if md.find(_qname("ExchangeMeteringPoint")) is not None:
                # Q13: grid interconnections have no customer meter.
                n_obs = len(list(md.iter(_qname("Observation"))))
                rows_total += n_obs
                skipped += n_obs
                note_product(
                    "__exchange__",
                    "Exchange metering points (grid interconnections) are not imported: no customer meter.",
                )
                continue
            add_error(errors, {"error": f"Block '{doc_id or '?'}' names no metering point; block skipped."})
            continue

        meter_id = _text(point_elem, "VSENationalID")
        mp = meter_lookup.get(meter_id) if meter_id else None
        if mp is None:
            add_error(errors, {"meter_id": meter_id or "?", "error": "Metering point not found in ZEV."})
            continue

        product_elem = md.find(_qname("Product"))
        product = _code(product_elem, "ID")
        observations = list(md.iter(_qname("Observation")))
        if product == PRODUCT_WIRKENERGIE:
            pass
        elif product == PRODUCT_BLINDENERGIE:
            rows_total += len(observations)
            skipped += len(observations)
            note_product(
                product,
                f"Skipped reactive energy observations (product {product}): OpenZEV bills active energy (kWh).",
            )
            continue
        elif product in (PRODUCT_LEG_ENERGIE, PRODUCT_LEG_RESTENERGIE):
            rows_total += len(observations)
            skipped += len(observations)
            note_product(
                product,
                f"Skipped LEG observations (product {product}): LEG energy billing is not supported yet.",
            )
            continue
        else:
            add_error(
                errors,
                {
                    "meter_id": meter_id,
                    "error": f"Unknown product '{product or '?'}' in block '{doc_id or '?'}'; block skipped.",
                },
            )
            continue

        # Q8: positions should run 1..n continuously; gaps are imported and
        # flagged, never a reason to drop the block.
        span_minutes = (end_ts - start_ts).total_seconds() / 60
        expected = int(span_minutes // res_minutes)
        seen_seqs = set()
        for obs in observations:
            try:
                seen_seqs.add(int(_sequence(obs)))
            except ValueError:
                pass
        if expected > 0 and len(seen_seqs) != expected and gap_warnings < MAX_GAP_WARNINGS:
            missing = expected - len(seen_seqs)
            warnings.append(
                {
                    "warning": (
                        f"Block '{doc_id or meter_id}': {missing} of {expected} positions "
                        f"missing; imported what was delivered."
                    )
                }
            )
            gap_warnings += 1

        for obs in observations:
            rows_total += 1
            seq_raw = _sequence(obs)
            try:
                seq = int(seq_raw)
                assert seq >= 1
            except (ValueError, AssertionError):
                skipped += 1
                add_error(errors, {"meter_id": meter_id, "error": f"Invalid Position '{seq_raw or '?'}'."})
                continue
            qty_raw = (_text(obs, "Volume") or "").strip()
            try:
                energy = Decimal(qty_raw).quantize(Decimal("0.0001"))
            except (InvalidOperation, ValueError, AttributeError):
                skipped += 1
                add_error(errors, {"meter_id": meter_id, "error": f"Invalid numeric value '{qty_raw}'."})
                continue
            if energy < 0:
                skipped += 1
                add_error(errors, {"meter_id": meter_id, "error": f"Negative volume '{qty_raw}' is not valid interval energy."})
                continue
            if abs(energy) > MAX_ENERGY_KWH:
                skipped += 1
                add_error(errors, {"meter_id": meter_id, "error": f"Volume '{qty_raw}' exceeds the storable range."})
                continue
            condition = _text(obs, "Condition")
            if condition not in ("", CONDITION_TEMPORARY, CONDITION_ESTIMATED):
                skipped += 1
                add_error(errors, {"meter_id": meter_id, "error": f"Unknown Condition '{condition}'."})
                continue
            ts = start_ts + timedelta(minutes=res_minutes * (seq - 1))

            # Q15: only E88 + (good|estimated) is billable.
            billable = reason == REASON_BILLING and condition in ("", CONDITION_ESTIMATED)

            key = (mp.pk, ts, direction)
            if key in written:
                skipped += 1
                continue
            written.add(key)

            quarantined_row = QuarantinedReading.objects.filter(
                metering_point=mp, timestamp=ts, direction=direction
            ).first()
            if (
                quarantined_row is not None
                and quarantined_row.source_creation is not None
                and quarantined_row.source_creation >= creation
            ):
                # A stale billable delivery must not displace newer quarantined data.
                skipped += 1
                continue

            if billable:
                existing = MeterReading.objects.filter(
                    metering_point=mp, timestamp=ts, direction=direction
                ).first()
                wrote = False
                if existing is None:
                    MeterReading.objects.create(
                        metering_point=mp,
                        timestamp=ts,
                        direction=direction,
                        energy_kwh=energy,
                        resolution=resolution,
                        import_source=ImportSource.SDATCH,
                        import_batch=batch_id,
                        source_creation=creation,
                        source_document_id=doc_id[:40],
                    )
                    imported += 1
                    wrote = True
                elif not is_replace:
                    skipped += 1
                elif existing.import_source != ImportSource.SDATCH:
                    # Never overwrite CSV/manual readings with a VNB re-delivery.
                    skipped += 1
                    note_product(
                        "__nonsdat__",
                        "Existing non-SDAT readings were kept; VNB replacements do not overwrite them.",
                    )
                elif existing.source_creation is not None and existing.source_creation >= creation:
                    skipped += 1
                else:
                    existing.energy_kwh = energy
                    existing.resolution = resolution
                    existing.import_batch = batch_id
                    existing.source_creation = creation
                    existing.source_document_id = doc_id[:40]
                    existing.save()
                    overwritten += 1
                    wrote = True
                # Q16: a billable delivery that was actually written promotes
                # quarantined predecessors into billing.
                if wrote and quarantined_row is not None:
                    quarantined_row.delete()
                    promoted += 1
            else:
                q_existing = QuarantinedReading.objects.filter(
                    metering_point=mp, timestamp=ts, direction=direction
                ).first()
                if q_existing is None:
                    # A stale info delivery must not shadow billable data.
                    current = MeterReading.objects.filter(
                        metering_point=mp, timestamp=ts, direction=direction
                    ).first()
                    if current is not None and current.source_creation is not None and current.source_creation >= creation:
                        skipped += 1
                        continue
                    QuarantinedReading.objects.create(
                        metering_point=mp,
                        timestamp=ts,
                        direction=direction,
                        energy_kwh=energy,
                        resolution=resolution,
                        import_batch=batch_id,
                        business_reason=reason[:10],
                        condition=condition[:5],
                        source_creation=creation,
                        source_document_id=doc_id[:40],
                    )
                    quarantined += 1
                elif q_existing.source_creation is not None and q_existing.source_creation >= creation:
                    skipped += 1
                else:
                    q_existing.energy_kwh = energy
                    q_existing.resolution = resolution
                    q_existing.import_batch = batch_id
                    q_existing.business_reason = reason[:10]
                    q_existing.condition = condition[:5]
                    q_existing.source_creation = creation
                    q_existing.source_document_id = doc_id[:40]
                    q_existing.save()
                    quarantined += 1

    for product, message in product_notes.items():
        warnings.append({"warning": message})
    if quarantined or promoted:
        warnings.append(
            {
                "warning": (
                    f"Quarantined {quarantined} info-only/temporary observations "
                    f"(not billable); promoted {promoted} to billing."
                )
            }
        )
    if gap_warnings >= MAX_GAP_WARNINGS:
        warnings.append({"warning": f"Further gap notes truncated after {MAX_GAP_WARNINGS} blocks."})

    log.rows_total = rows_total
    log.rows_imported = imported
    log.rows_overwritten = overwritten
    log.rows_skipped = skipped
    log.errors = errors
    log.warnings = warnings
    log.save()
    return log
