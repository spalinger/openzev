"""
SDAT-CH (ebIX XML) metering data importer — strict first-release profile.

Supported profile (see ``docs/specs/2026-10-sdat-ch-compatibility-plan.md``):

- Root ``ValidatedMeteredData_16``, namespace ``http://www.strom.ch``,
  validated against the vendored 1.6 XSD bundle. Any other root or schema
  version is rejected before any observation is written.
- Document type exactly ``E66``; header status ``9`` (original) or ``5``
  (replacement). Status ``1`` (cancellation) is rejected with a named error.
- Business reason ``E88`` (billing) or ``C38`` (information). Every other
  schema-valid reason (``C40`` LEG settlement, ``C23`` queries, …) is a named
  unsupported profile: E66 root alone never implies support.
- Resolution fixed at 15 minutes (``15``/``MIN``); active energy
  (``8716867000030``) in ``KWH``. Reactive and LEG products and grid
  interconnection points are intentional, reported exclusions — never billing
  data. Unknown products or incompatible units reject the whole file.
- Timestamps are stored at interval start: ``start + (sequence - 1) * 15min``.
  Source timestamps describe interval ends; storing the left endpoint is the
  documented conversion to the backend interval-start convention, not a shift.

File atomicity: a supported billing block with invalid data (unknown or
ambiguous meters, incompatible units, invalid positions, incomplete coverage,
conflicting overlaps, CSV/manual source conflicts, equal-Creation value
conflicts) rejects the ENTIRE file — no observation row is written and prior
readings are unchanged. The failure is still recorded as an ``ImportLog``
(status ``rejected``) with structured issue codes. Files in a multi-file
upload stay independent.

Revision selection is deterministic under concurrency: a transaction plus a
per-ZEV advisory lock (PostgreSQL) and row locks serialize freshness
decisions; absent rows are protected by the unique constraint with one
retry. Arrival order never wins — only ``Creation`` decides. Different values
at equal ``Creation`` reject the conflicting file and expose both document
identities; identical repeats are idempotent.

Routing: ``E88`` with measured/estimated observations goes to
``MeterReading``; ``C38`` and temporary (``21``) observations go to
``QuarantinedReading``, invisible to billing until a billable delivery
promotes them. Validated and informational freshness are tracked
independently: newer held data never blocks validated billing.
"""

import gzip
import io
import os
import re
import struct
import tempfile
import uuid
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, connection, transaction
from lxml import etree

from metering.models import (
    ImportLog,
    ImportSource,
    MeterReading,
    QuarantinedReading,
    ReadingChangeKind,
    ReadingDirection,
    ReadingResolution,
    SdatResultStatus,
)
from metering.importers.limits import MAX_UPLOAD_BYTES, add_error, mb
from zev.models import AmbiguousMeterIdentity, resolve_metering_point

MAX_SDAT_BYTES = MAX_UPLOAD_BYTES
MAX_SDAT_DECOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_ISSUES = 200
READING_CHANGE_CAP = 10_000

SDAT_NS = "http://www.strom.ch"
STRICT_ROOT = "ValidatedMeteredData_16"

PRODUCT_WIRKENERGIE = "8716867000030"
PRODUCT_BLINDENERGIE = "8716867000047"
PRODUCT_LEG_ENERGIE = "2404050010123"
PRODUCT_LEG_RESTENERGIE = "2404050010124"
UNIT_KWH = "KWH"

REASON_BILLING = "E88"
REASON_INFO = "C38"
CONDITION_TEMPORARY = "21"
CONDITION_ESTIMATED = "56"

STATUS_ORIGINAL = "9"
STATUS_REPLACE = "5"
STATUS_CANCELLATION = "1"

RESOLUTION_MINUTES = 15
RESOLUTION_LABEL = ReadingResolution.FIFTEEN_MIN

MAX_ENERGY_KWH = Decimal("99999999.9999")

# Stable issue codes (see the import baseline spec). Do not rename them.
ISSUE_UNSUPPORTED_ROOT = "unsupported_root"
ISSUE_UNSUPPORTED_SCHEMA_VERSION = "unsupported_schema_version"
ISSUE_SCHEMA_INVALID = "schema_invalid"
ISSUE_CANCELLATION_REJECTED = "cancellation_rejected"
ISSUE_UNSUPPORTED_STATUS = "unsupported_status"
ISSUE_UNSUPPORTED_DOCUMENT_TYPE = "unsupported_document_type"
ISSUE_MISSING_CREATION = "missing_creation"
ISSUE_INVALID_CREATION = "invalid_creation"
ISSUE_MISSING_REASON = "missing_reason"
ISSUE_UNSUPPORTED_REASON = "unsupported_reason"
ISSUE_INVALID_HEADER = "invalid_header"
ISSUE_UNKNOWN_METER = "unknown_meter"
ISSUE_AMBIGUOUS_METER = "ambiguous_meter"
ISSUE_MISSING_INTERVAL = "missing_interval"
ISSUE_INVALID_INTERVAL = "invalid_interval"
ISSUE_UNALIGNED_INTERVAL = "unaligned_interval"
ISSUE_MISSING_RESOLUTION = "missing_resolution"
ISSUE_UNSUPPORTED_RESOLUTION = "unsupported_resolution"
ISSUE_MISSING_METER_POINT = "missing_meter_point"
ISSUE_UNKNOWN_PRODUCT = "unknown_product"
ISSUE_UNSUPPORTED_UNIT = "unsupported_unit"
ISSUE_INVALID_POSITION = "invalid_position"
ISSUE_MISSING_POSITION = "missing_position"
ISSUE_DUPLICATE_POSITION = "duplicate_position"
ISSUE_CONFLICTING_POSITION = "conflicting_position"
ISSUE_INVALID_VOLUME = "invalid_volume"
ISSUE_UNKNOWN_CONDITION = "unknown_condition"
ISSUE_NAIVE_TIMESTAMP = "naive_timestamp"
ISSUE_EQUAL_CREATION_CONFLICT = "equal_creation_conflict"
ISSUE_SOURCE_CONFLICT = "source_conflict"
ISSUE_FILE_TOO_LARGE = "file_too_large"
ISSUE_DECOMPRESSED_TOO_LARGE = "decompressed_too_large"
ISSUE_GZIP_ERROR = "gzip_error"
ISSUE_MALFORMED_XML = "malformed_xml"
ISSUE_EMPTY_DELIVERY = "empty_delivery"
ISSUE_REACTIVE_EXCLUDED = "reactive_excluded"
ISSUE_LEG_EXCLUDED = "leg_excluded"
ISSUE_EXCHANGE_EXCLUDED = "exchange_excluded"
ISSUE_STALE_SUPERSEDED = "stale_superseded"
ISSUE_DUPLICATE_DELIVERY = "duplicate_delivery"
ISSUE_TOO_MANY_ISSUES = "too_many_issues"
ISSUE_INTERNAL_ERROR = "internal_error"

COUNT_KEYS = (
    "created",
    "overwritten",
    "held",
    "promoted",
    "duplicate",
    "stale",
    "excluded",
    "rejected",
    "quarantine_overwritten",
)

# Schema-valid reasons outside the ZEV billing profile.
UNSUPPORTED_REASON_PROFILES = {
    "C40": "LEG settlement",
    "C23": "metering-data query",
    "C12": "master-data notification",
    "C37": "metering-information request",
    "C87": "switching process",
    "C89": "switching response",
    "E44": "metering-point master data",
    "E89": "aggregated balance data",
    "E0D": "imbalance settlement",
}


def _qname(local: str) -> str:
    return f"{{{SDAT_NS}}}{local}"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _text(elem, local: str) -> str:
    child = elem.find(_qname(local)) if elem is not None else None
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
    attr_tag = "{http://www.w3.org/2001/XMLSchema}attribute"
    with tempfile.TemporaryDirectory(prefix="sdat_xsd_") as tmpdir:
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


def _has_tz_designator(value: str) -> bool:
    """Whether a timestamp carries an explicit zone (``Z`` or ``±hh:mm``)."""
    text = (value or "").strip()
    return text.endswith("Z") or bool(re.search(r"[+-]\d{2}:?\d{2}$", text))


def _parse_ts_strict(value: str) -> datetime:
    """Parse an SDAT-CH timestamp to an aware UTC datetime.

    The 1.6 schema type ``EnergyDateTimeType`` requires an explicit ``Z``
    suffix (UTC exclusively); offset-less wall-clock timestamps are not part
    of the strict profile and are rejected rather than reinterpreted.
    """
    text = (value or "").strip()
    if not text:
        raise ValueError("empty timestamp")
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"timestamp without timezone offset: '{text}'")
    return parsed.astimezone(timezone.utc)


@dataclass
class _PlannedObservation:
    meter_id: str
    metering_point: object
    timestamp: datetime
    direction: str
    energy: Decimal
    condition: str
    billable: bool
    block_id: str


@dataclass
class _PlanBlock:
    document_id: str
    product: str
    unit: str
    observations: list = field(default_factory=list)


class _FileRejected(Exception):
    """Raised to abort a file with structured issues; never carries writes."""

    def __init__(self, issues):
        super().__init__(issues[0]["message"] if issues else "SDAT-CH file rejected.")
        self.issues = list(issues)


def _issue(code, message, *, severity="error", **params):
    entry = {"code": code, "severity": severity, "message": message}
    entry.update(params)
    return entry


def _zero_counts():
    return {key: 0 for key in COUNT_KEYS}


class _ImportRun:
    """Accumulates one file's parse state, counters and structured issues."""

    def __init__(self):
        self.rows_total = 0
        self.counts = _zero_counts()
        self.issues = []
        self.warnings = []
        self.delivery = {}

    def add_issue(self, code, message, *, severity="error", **params):
        if len(self.issues) < MAX_ISSUES:
            self.issues.append(_issue(code, message, severity=severity, **params))
        elif len(self.issues) == MAX_ISSUES:
            self.issues.append(
                _issue(
                    ISSUE_TOO_MANY_ISSUES,
                    f"Too many issues — showing first {MAX_ISSUES}; further issues truncated.",
                )
            )

    def legacy_errors(self):
        """Error-severity issues in the legacy ImportLog.errors shape."""
        errors = []
        for issue in self.issues:
            if issue.get("severity") != "error":
                continue
            entry = {"error": issue["message"]}
            if issue.get("meter_id"):
                entry["meter_id"] = issue["meter_id"]
            add_error(errors, entry)
        return errors

    def legacy_warnings(self):
        return list(self.warnings)


def _fail_log(log, run):
    """Persist a rejected outcome: no observation writes, truthful log."""
    excluded = run.counts["excluded"]
    run.counts = _zero_counts()
    run.counts.update(excluded=excluded, rejected=run.rows_total - excluded)
    run.warnings = []
    _add_legacy_warnings(run)
    log.rows_total = run.rows_total
    log.rows_imported = 0
    log.rows_overwritten = 0
    log.rows_skipped = run.counts["excluded"]
    log.errors = run.legacy_errors() or [{"error": "SDAT-CH file rejected."}]
    log.warnings = run.legacy_warnings()
    log.result_status = SdatResultStatus.REJECTED
    log.result_counts = run.counts
    log.issues = run.issues
    log.reading_changes = []
    log.source_delivery = run.delivery
    log.save()
    return log


def _finalize_log(log, run, *, status, changes, changes_truncated):
    log.rows_total = run.rows_total
    log.rows_imported = run.counts["created"]
    log.rows_overwritten = run.counts["overwritten"]
    log.rows_skipped = (
        run.counts["duplicate"] + run.counts["stale"] + run.counts["excluded"]
    )
    log.errors = run.legacy_errors()
    log.warnings = run.legacy_warnings()
    log.result_status = status
    counts = dict(run.counts)
    counts["reading_changes_truncated"] = bool(changes_truncated)
    log.result_counts = counts
    log.issues = run.issues
    log.reading_changes = changes
    log.source_delivery = run.delivery
    log.save()
    return log


def _sender_identity(header):
    """Best-effort sender/receiver identity: identifier text plus role."""

    def _party(local):
        elem = header.find(_qname(local)) if header is not None else None
        if elem is None:
            return "", ""
        ident = elem.find(_qname("ID"))
        code = ""
        if ident is not None:
            for child in list(ident):
                if child.text and child.text.strip():
                    code = child.text.strip()
                    break
        return code, _text(elem, "Role")

    sender_id, sender_role = _party("Sender")
    receiver_id, receiver_role = _party("Receiver")
    return sender_id, sender_role, receiver_id, receiver_role


def _validate_header(run, root):
    """Validate the delivery header; returns (delivery, reason, creation, is_replace).

    Raises _FileRejected before any observation is touched.
    """
    header = root.find(_qname("ValidatedMeteredData_HeaderInformation"))
    if header is None:
        raise _FileRejected(
            [_issue(ISSUE_INVALID_HEADER, "Missing ValidatedMeteredData_HeaderInformation.")]
        )
    instance = header.find(_qname("InstanceDocument"))
    if instance is None:
        raise _FileRejected(
            [_issue(ISSUE_INVALID_HEADER, "Missing InstanceDocument header.")]
        )
    delivery_id = _text(instance, "DocumentID")
    doc_type = _code(instance, "DocumentType")
    if doc_type != "E66":
        raise _FileRejected(
            [
                _issue(
                    ISSUE_UNSUPPORTED_DOCUMENT_TYPE,
                    f"DocumentType is not E66 (ValidatedMeteredData): '{doc_type or '?'}'. Nothing was imported.",
                )
            ]
        )
    status = _text(instance, "Status")
    if status == STATUS_CANCELLATION:
        raise _FileRejected(
            [
                _issue(
                    ISSUE_CANCELLATION_REJECTED,
                    "Document Status is 1 (cancellation). Cancellations are not imported.",
                )
            ]
        )
    if status not in (STATUS_ORIGINAL, STATUS_REPLACE):
        raise _FileRejected(
            [
                _issue(
                    ISSUE_UNSUPPORTED_STATUS,
                    f"Document Status '{status or '?'}' is not supported for import (expected 9 original or 5 replacement). Nothing was imported.",
                )
            ]
        )
    creation_raw = _text(instance, "Creation")
    if not creation_raw:
        raise _FileRejected(
            [_issue(ISSUE_MISSING_CREATION, "Missing InstanceDocument Creation; delivery order cannot be verified. Nothing was imported.")]
        )
    try:
        creation = _parse_ts_strict(creation_raw)
    except ValueError:
        raise _FileRejected(
            [_issue(ISSUE_INVALID_CREATION, f"Invalid Creation timestamp '{creation_raw}'. Nothing was imported.")]
        )
    scope = header.find(_qname("BusinessScopeProcess"))
    reason = _code(scope, "BusinessReasonType")
    if not reason:
        raise _FileRejected(
            [_issue(ISSUE_MISSING_REASON, "Missing BusinessReasonType; the delivery profile is unknown. Nothing was imported.")]
        )
    if reason not in (REASON_BILLING, REASON_INFO):
        profile = UNSUPPORTED_REASON_PROFILES.get(reason, "another market role")
        raise _FileRejected(
            [
                _issue(
                    ISSUE_UNSUPPORTED_REASON,
                    f"BusinessReason {reason} ({profile}) is not supported for ZEV billing import; "
                    f"supported reasons are E88 (billing) and C38 (information). Nothing was imported.",
                    reason=reason,
                )
            ]
        )
    sender_id, sender_role, receiver_id, receiver_role = _sender_identity(header)
    run.delivery = {
        "delivery_id": delivery_id,
        "creation": creation.isoformat(),
        "status": status,
        "reason": reason,
        "sender_id": sender_id,
        "sender_role": sender_role,
        "receiver_id": receiver_id,
        "receiver_role": receiver_role,
    }
    return run.delivery, reason, creation, status == STATUS_REPLACE


def _parse_block(md, *, reason):
    """Parse one MeteringData block.

    Returns ("block", _PlanBlock), ("excluded", count, note-issue) or raises
    _FileRejected for any invalid supported billing data.
    """
    doc_id = _text(md, "DocumentID") or "?"

    def reject(code, message, **params):
        raise _FileRejected([_issue(code, message, **params)])

    interval = md.find(_qname("Interval"))
    if interval is None:
        reject(ISSUE_MISSING_INTERVAL, f"Block '{doc_id}' has no Interval; file rejected.")
    start_raw = _text(interval, "StartDateTime")
    end_raw = _text(interval, "EndDateTime")
    for raw_ts in (start_raw, end_raw):
        if not _has_tz_designator(raw_ts):
            reject(
                ISSUE_NAIVE_TIMESTAMP,
                f"Block '{doc_id}' carries an offset-less Interval timestamp; strict SDAT-CH 1.6 uses UTC exclusively; file rejected.",
                block_id=doc_id,
            )
    try:
        start_ts = _parse_ts_strict(start_raw)
        end_ts = _parse_ts_strict(end_raw)
    except ValueError as exc:
        reject(ISSUE_INVALID_INTERVAL, f"Invalid Interval timestamps in block '{doc_id}': {exc}; file rejected.", block_id=doc_id)
    if end_ts <= start_ts:
        reject(ISSUE_INVALID_INTERVAL, f"Empty Interval in block '{doc_id}'; file rejected.", block_id=doc_id)
    span = end_ts - start_ts
    if span.microseconds or span.seconds % 60:
        reject(ISSUE_INVALID_INTERVAL, f"Block '{doc_id}' Interval is not a whole-minute span; file rejected.", block_id=doc_id)
    if (
        start_ts.second
        or start_ts.microsecond
        or end_ts.second
        or end_ts.microsecond
        or (start_ts.minute % RESOLUTION_MINUTES)
        or (end_ts.minute % RESOLUTION_MINUTES)
    ):
        reject(
            ISSUE_UNALIGNED_INTERVAL,
            f"Block '{doc_id}' Interval is not aligned to the 15-minute grid; file rejected.",
            block_id=doc_id,
        )
    span_minutes = int(span.total_seconds() // 60)
    if span_minutes % RESOLUTION_MINUTES:
        reject(
            ISSUE_UNALIGNED_INTERVAL,
            f"Block '{doc_id}' Interval spans {span_minutes} minutes, not divisible into 15-minute positions; file rejected.",
            block_id=doc_id,
        )
    expected = span_minutes // RESOLUTION_MINUTES

    res_elem = md.find(_qname("Resolution"))
    if res_elem is None:
        reject(
            ISSUE_MISSING_RESOLUTION,
            f"Block '{doc_id}' has no Resolution; the strict SDAT-CH 1.6 profile fixes Resolution 15/MIN; file rejected.",
            block_id=doc_id,
        )
    try:
        res_value = int((_text(res_elem, "Resolution") or "").strip())
    except ValueError:
        res_value = None
    unit = (_text(res_elem, "Unit") or "").strip().upper()
    if res_value != RESOLUTION_MINUTES or unit != "MIN":
        reject(
            ISSUE_UNSUPPORTED_RESOLUTION,
            f"Block '{doc_id}' Resolution is '{res_value or '?'}'/'{unit or '?'}'; only 15/MIN is supported for billing import; file rejected.",
            block_id=doc_id,
        )

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
    observations = list(md.iter(_qname("Observation")))
    if point_elem is None:
        if md.find(_qname("ExchangeMeteringPoint")) is not None:
            return ("excluded", len(observations), _issue(
                ISSUE_EXCHANGE_EXCLUDED,
                "Exchange metering points (grid interconnections) are not imported: no customer meter.",
                block_id=doc_id,
            ))
        reject(ISSUE_MISSING_METER_POINT, f"Block '{doc_id}' names no metering point; file rejected.", block_id=doc_id)

    meter_id = _text(point_elem, "VSENationalID")
    product_elem = md.find(_qname("Product"))
    product = _code(product_elem, "ID")
    measure_unit = (_text(product_elem, "MeasureUnit") or "").strip().upper() if product_elem is not None else ""
    if product == PRODUCT_BLINDENERGIE:
        return ("excluded", len(observations), _issue(
            ISSUE_REACTIVE_EXCLUDED,
            f"Skipped reactive energy observations (product {product}): OpenZEV bills active energy (kWh).",
            block_id=doc_id,
            product=product,
        ))
    if product in (PRODUCT_LEG_ENERGIE, PRODUCT_LEG_RESTENERGIE):
        return ("excluded", len(observations), _issue(
            ISSUE_LEG_EXCLUDED,
            f"Skipped LEG observations (product {product}): LEG energy billing is not supported yet.",
            block_id=doc_id,
            product=product,
        ))
    if product != PRODUCT_WIRKENERGIE:
        reject(
            ISSUE_UNKNOWN_PRODUCT,
            f"Unknown product '{product or '?'}' in block '{doc_id}'; file rejected.",
            block_id=doc_id,
            meter_id=meter_id or None,
            product=product or None,
        )
    if measure_unit != UNIT_KWH:
        reject(
            ISSUE_UNSUPPORTED_UNIT,
            f"Unsupported MeasureUnit '{measure_unit or '?'}' for active energy in block '{doc_id}'; only KWH is billed, without conversion; file rejected.",
            block_id=doc_id,
            meter_id=meter_id or None,
            product=product,
            unit=measure_unit or None,
        )

    seqs = []
    for obs in observations:
        seq_raw = _sequence(obs)
        try:
            seq = int(seq_raw)
        except (TypeError, ValueError):
            seq = None
        if seq is None or seq < 1 or seq > expected:
            reject(
                ISSUE_INVALID_POSITION,
                f"Position '{seq_raw or '?'}' in block '{doc_id}' is outside the declared interval (1..{expected}); file rejected.",
                block_id=doc_id,
                meter_id=meter_id or None,
                position=seq_raw or None,
            )
        seqs.append(seq)
    if len(set(seqs)) != len(seqs):
        seen = set()
        dup = next(s for s in seqs if s in seen or seen.add(s))
        # Same slot with a different value is a conflict, not a duplicate.
        values = {}
        for obs, seq in zip(observations, seqs):
            if seq == dup:
                values.setdefault((_text(obs, "Volume") or "").strip(), []).append(obs)
        if len(values) > 1:
            reject(
                ISSUE_CONFLICTING_POSITION,
                f"Position {dup} in block '{doc_id}' carries conflicting values; file rejected.",
                block_id=doc_id,
                meter_id=meter_id or None,
                position=dup,
            )
        reject(
            ISSUE_DUPLICATE_POSITION,
            f"Position {dup} in block '{doc_id}' is delivered twice; file rejected.",
            block_id=doc_id,
            meter_id=meter_id or None,
            position=dup,
        )
    if len(seqs) != expected:
        from itertools import islice

        present = set(seqs)
        missing_count = expected - len(seqs)
        missing = list(islice((position for position in range(1, expected + 1) if position not in present), 50))
        shown = ", ".join(str(m) for m in missing[:10])
        suffix = "" if missing_count <= 10 else f" (+{missing_count - 10} more)"
        reject(
            ISSUE_MISSING_POSITION,
            f"Block '{doc_id}' is missing positions {shown}{suffix} of {expected}; readings are never invented; file rejected.",
            block_id=doc_id,
            meter_id=meter_id or None,
            missing=missing[:50],
        )

    by_seq = {}
    for obs, seq in zip(observations, seqs):
        by_seq[seq] = obs
    planned = []
    for seq in range(1, expected + 1):
        obs = by_seq[seq]
        qty_raw = (_text(obs, "Volume") or "").strip()
        try:
            energy = Decimal(qty_raw)
        except (InvalidOperation, ValueError, AttributeError):
            energy = None
        if energy is None or not energy.is_finite():
            reject(
                ISSUE_INVALID_VOLUME,
                f"Invalid numeric value '{qty_raw or '?'}' at position {seq} in block '{doc_id}'; file rejected.",
                block_id=doc_id,
                meter_id=meter_id or None,
                position=seq,
            )
        if energy < 0:
            reject(
                ISSUE_INVALID_VOLUME,
                f"Negative volume '{qty_raw}' at position {seq} in block '{doc_id}' is not valid interval energy; file rejected.",
                block_id=doc_id,
                meter_id=meter_id or None,
                position=seq,
            )
        if abs(energy) > MAX_ENERGY_KWH:
            reject(
                ISSUE_INVALID_VOLUME,
                f"Volume '{qty_raw}' at position {seq} in block '{doc_id}' exceeds the storable range; file rejected.",
                block_id=doc_id,
                meter_id=meter_id or None,
                position=seq,
            )
        energy = energy.quantize(Decimal("0.0001"))
        condition = _text(obs, "Condition")
        if condition not in ("", CONDITION_TEMPORARY, CONDITION_ESTIMATED):
            reject(
                ISSUE_UNKNOWN_CONDITION,
                f"Unknown Condition '{condition}' at position {seq} in block '{doc_id}'; file rejected.",
                block_id=doc_id,
                meter_id=meter_id or None,
                position=seq,
            )
        ts = start_ts + timedelta(minutes=RESOLUTION_MINUTES * (seq - 1))
        billable = reason == REASON_BILLING and condition in ("", CONDITION_ESTIMATED)
        planned.append(
            _PlannedObservation(
                meter_id=meter_id,
                metering_point=None,
                timestamp=ts,
                direction=direction,
                energy=energy,
                condition=condition,
                billable=billable,
                block_id=doc_id,
            )
        )
    return (
        "block",
        _PlanBlock(
            document_id=doc_id,
            product=product,
            unit=measure_unit,
            observations=planned,
        ),
    )


def _lock_zev_imports(zev):
    """Serialize SDAT-CH write phases per ZEV on PostgreSQL.

    Row locks alone cannot protect not-yet-existing slots; the advisory
    transaction lock makes concurrent imports of one ZEV take turns while
    unrelated ZEVs stay parallel. Correctness never depends on it alone:
    the unique constraint plus one retry covers racers from other writers.
    """
    if connection.vendor == "postgresql":
        key = struct.unpack("i", struct.pack("I", zlib.crc32(str(zev.pk).encode("utf-8"))))[0]
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s, %s)", [1641412, key])


def _fetch_existing(meter_pks):
    """Bulk-load existing billable + quarantine rows for the planned slots."""
    by_key_billable = {}
    by_key_quarantine = {}
    for pk, bounds in meter_pks.items():
        for direction, (earliest, latest) in bounds.items():
            bill_qs = MeterReading.objects.filter(
                metering_point_id=pk,
                direction=direction,
                timestamp__gte=earliest,
                timestamp__lte=latest,
            )
            quar_qs = QuarantinedReading.objects.filter(
                metering_point_id=pk,
                direction=direction,
                timestamp__gte=earliest,
                timestamp__lte=latest,
            )
            for row in bill_qs.select_for_update():
                by_key_billable[(row.metering_point_id, row.timestamp, row.direction)] = row
            for row in quar_qs.select_for_update():
                by_key_quarantine[(row.metering_point_id, row.timestamp, row.direction)] = row
    return by_key_billable, by_key_quarantine


def _is_protected_source(row):
    return row is not None and row.import_source != ImportSource.SDATCH


def _decide_slot(obs, *, existing, quarantined, is_replace, creation):
    """Decide one slot. Returns (action, payload).

    Actions: create-billable, overwrite-billable, skip (counter name),
    hold (create/update quarantine), reject-source, reject-conflict.
    Promotion (deleting the matching quarantine row) is handled by the
    caller whenever a billable write actually commits.
    """
    if obs.billable:
        if existing is not None and _is_protected_source(existing):
            return ("reject-source", existing)
        # Validated and informational freshness are independent: newer held
        # data never blocks validated billing; the caller only removes predecessors.
        if existing is None:
            return ("create-billable", None)
        existing_creation = existing.source_creation
        if existing_creation is not None and creation < existing_creation:
            return ("skip", "stale")
        if existing_creation is not None and creation == existing_creation:
            if existing.energy_kwh == obs.energy:
                return ("skip", "duplicate")
            return ("reject-conflict", existing)
        if not is_replace:
            # Originals never overwrite: skip-existing, even when newer.
            return ("skip", "duplicate")
        return ("overwrite-billable", None)
    if existing is not None and _is_protected_source(existing):
        return ("reject-source", existing)
    if quarantined is None:
        if (
            existing is not None
            and existing.source_creation is not None
            and existing.source_creation >= creation
        ):
            # A stale info delivery must not shadow validated billing data.
            return ("skip", "stale")
        return ("hold", "create")
    quar_creation = quarantined.source_creation
    if quar_creation is not None and creation < quar_creation:
        return ("skip", "stale")
    if quar_creation is not None and creation == quar_creation:
        if quarantined.energy_kwh == obs.energy:
            return ("skip", "duplicate")
        return ("reject-conflict", quarantined)
    return ("hold", "update")


def _conflict_issue(obs, row, *, creation, delivery_id):
    return _issue(
        ISSUE_EQUAL_CREATION_CONFLICT,
        f"Equal-Creation conflict at {obs.timestamp.isoformat()} ({obs.direction}): "
        f"incoming block '{obs.block_id}' of delivery '{delivery_id}' (Creation {creation.isoformat()}) disagrees with "
        f"stored document '{row.source_document_id or '?'}'; file rejected, both identities reported.",
        meter_id=obs.meter_id,
        position_timestamp=obs.timestamp.isoformat(),
        direction=obs.direction,
        incoming_document_id=obs.block_id,
        incoming_delivery_id=delivery_id,
        stored_document_id=row.source_document_id or None,
        stored_delivery_id=row.source_delivery_id or None,
    )


def _apply_plan(*, batch_id, blocks, reason, creation, delivery_id, is_replace, run):
    """Compare + write every planned slot inside the caller's transaction."""
    bounds = {}
    for block in blocks:
        for obs in block.observations:
            slot = bounds.setdefault(obs.metering_point.pk, {}).setdefault(
                obs.direction, [obs.timestamp, obs.timestamp]
            )
            slot[0] = min(slot[0], obs.timestamp)
            slot[1] = max(slot[1], obs.timestamp)
    by_key_billable, by_key_quarantine = _fetch_existing(bounds)

    new_billable = []
    update_billable = []
    new_quarantine = []
    update_quarantine = []
    drop_quarantine = []
    changes = []
    changes_truncated = False

    def record_change(obs, *, kind, old, new, promoted=False):
        nonlocal changes_truncated
        if len(changes) >= READING_CHANGE_CAP:
            changes_truncated = True
            return
        changes.append(
            {
                "metering_point": str(obs.metering_point.pk),
                "meter_id": obs.metering_point.meter_id,
                "timestamp": obs.timestamp.isoformat(),
                "direction": obs.direction,
                "kind": kind,
                "old_energy": str(old) if old is not None else None,
                "new_energy": str(new),
                "promoted": bool(promoted),
                "source_document_id": obs.block_id,
            }
        )

    for block in blocks:
        for obs in block.observations:
            key = (obs.metering_point.pk, obs.timestamp, obs.direction)
            existing = by_key_billable.get(key)
            quarantined = by_key_quarantine.get(key)
            action, payload = _decide_slot(
                obs,
                existing=existing,
                quarantined=quarantined,
                is_replace=is_replace,
                creation=creation,
            )
            if action == "reject-source":
                raise _FileRejected(
                    [
                        _issue(
                            ISSUE_SOURCE_CONFLICT,
                            f"Overlapping non-SDAT reading at {obs.timestamp.isoformat()} "
                            f"({obs.direction}, meter '{obs.meter_id}'): VNB deliveries never overwrite "
                            f"CSV/manual data; file rejected, existing data preserved.",
                            meter_id=obs.meter_id,
                            position_timestamp=obs.timestamp.isoformat(),
                            direction=obs.direction,
                            block_id=obs.block_id,
                        )
                    ]
                )
            if action == "reject-conflict":
                raise _FileRejected([_conflict_issue(obs, payload, creation=creation, delivery_id=delivery_id)])
            if action == "skip":
                run.counts[payload] += 1
                continue
            if action == "create-billable":
                row = MeterReading(
                    metering_point=obs.metering_point,
                    timestamp=obs.timestamp,
                    direction=obs.direction,
                    energy_kwh=obs.energy,
                    resolution=RESOLUTION_LABEL,
                    import_source=ImportSource.SDATCH,
                    import_batch=batch_id,
                    source_creation=creation,
                    source_document_id=obs.block_id[:40],
                    source_delivery_id=delivery_id[:64],
                    business_reason=reason[:10],
                    condition=obs.condition[:5],
                    source_product=block.product[:32],
                    source_unit=block.unit[:10],
                    source_meter_id=obs.meter_id[:64],
                )
                new_billable.append(row)
                by_key_billable[key] = row
                run.counts["created"] += 1
                promoted_here = False
                if quarantined is not None and (
                    quarantined.source_creation is None or quarantined.source_creation <= creation
                ):
                    # Newer held discrepancies stay visible instead of being silently deleted.
                    drop_quarantine.append(quarantined)
                    del by_key_quarantine[key]
                    run.counts["promoted"] += 1
                    promoted_here = True
                record_change(obs, kind=ReadingChangeKind.AVAILABILITY, old=None, new=obs.energy, promoted=promoted_here)
                continue
            if action == "overwrite-billable":
                old_energy = existing.energy_kwh
                input_changed = old_energy != obs.energy or existing.resolution != RESOLUTION_LABEL
                existing.energy_kwh = obs.energy
                existing.resolution = RESOLUTION_LABEL
                existing.import_batch = batch_id
                existing.source_creation = creation
                existing.source_document_id = obs.block_id[:40]
                existing.source_delivery_id = delivery_id[:64]
                existing.business_reason = reason[:10]
                existing.condition = obs.condition[:5]
                existing.source_product = block.product[:32]
                existing.source_unit = block.unit[:10]
                existing.source_meter_id = obs.meter_id[:64]
                update_billable.append(existing)
                run.counts["overwritten"] += 1
                promoted_here = False
                if quarantined is not None and (
                    quarantined.source_creation is None or quarantined.source_creation <= creation
                ):
                    drop_quarantine.append(quarantined)
                    del by_key_quarantine[key]
                    run.counts["promoted"] += 1
                    promoted_here = True
                kind = ReadingChangeKind.VALUE if input_changed else ReadingChangeKind.METADATA
                record_change(obs, kind=kind, old=old_energy, new=obs.energy, promoted=promoted_here)
                continue
            if payload == "create":
                new_quarantine.append(
                    QuarantinedReading(
                        metering_point=obs.metering_point,
                        timestamp=obs.timestamp,
                        direction=obs.direction,
                        energy_kwh=obs.energy,
                        resolution=RESOLUTION_LABEL,
                        import_source=ImportSource.SDATCH,
                        import_batch=batch_id,
                        business_reason=reason[:10],
                        condition=obs.condition[:5],
                        source_creation=creation,
                        source_document_id=obs.block_id[:40],
                        source_delivery_id=delivery_id[:64],
                        source_product=block.product[:32],
                        source_unit=block.unit[:10],
                        source_meter_id=obs.meter_id[:64],
                    )
                )
                run.counts["held"] += 1
            else:
                quarantined.energy_kwh = obs.energy
                quarantined.resolution = RESOLUTION_LABEL
                quarantined.import_batch = batch_id
                quarantined.business_reason = reason[:10]
                quarantined.condition = obs.condition[:5]
                quarantined.source_creation = creation
                quarantined.source_document_id = obs.block_id[:40]
                quarantined.source_delivery_id = delivery_id[:64]
                quarantined.source_product = block.product[:32]
                quarantined.source_unit = block.unit[:10]
                quarantined.source_meter_id = obs.meter_id[:64]
                update_quarantine.append(quarantined)
                run.counts["held"] += 1
                run.counts["quarantine_overwritten"] += 1

    if new_billable:
        MeterReading.objects.bulk_create(new_billable)
    if update_billable:
        MeterReading.objects.bulk_update(
            update_billable,
            [
                "energy_kwh",
                "resolution",
                "import_batch",
                "source_creation",
                "source_document_id",
                "source_delivery_id",
                "business_reason",
                "condition",
                "source_product",
                "source_unit",
                "source_meter_id",
            ],
        )
    if new_quarantine:
        QuarantinedReading.objects.bulk_create(new_quarantine)
    if update_quarantine:
        QuarantinedReading.objects.bulk_update(
            update_quarantine,
            [
                "energy_kwh",
                "resolution",
                "import_batch",
                "business_reason",
                "condition",
                "source_creation",
                "source_document_id",
                "source_delivery_id",
                "source_product",
                "source_unit",
                "source_meter_id",
            ],
        )
    if drop_quarantine:
        QuarantinedReading.objects.filter(pk__in=[row.pk for row in drop_quarantine]).delete()
    return changes, changes_truncated


def _fail_early(log, code, message, **params):
    run = _ImportRun()
    run.add_issue(code, message, **params)
    return _fail_log(log, run)


def import_sdatch(file, zev, user):
    """
    Import metering readings from a SDAT-CH ValidatedMeteredData XML file.

    Returns an ImportLog instance. Supported files either commit a complete,
    correctly classified result or leave observation data unchanged with a
    truthful rejected log — never a partial write.
    """
    from allocation.validity import business_tz

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
    run = _ImportRun()

    # Size hints may be missing or wrong; actual byte counts are enforced below.
    size_hint = getattr(file, "size", None)
    if size_hint is not None and size_hint > MAX_SDAT_BYTES:
        return _fail_early(
            log,
            ISSUE_FILE_TOO_LARGE,
            f"File too large ({mb(size_hint)}). Maximum is {mb(MAX_SDAT_BYTES)}.",
        )

    try:
        raw = file.read(MAX_SDAT_BYTES + 1)
    except Exception as exc:
        return _fail_early(log, ISSUE_GZIP_ERROR, f"Could not read uploaded file: {exc}")
    if len(raw) > MAX_SDAT_BYTES:
        return _fail_early(
            log,
            ISSUE_FILE_TOO_LARGE,
            f"File too large ({mb(len(raw))}). Maximum is {mb(MAX_SDAT_BYTES)}.",
        )

    if filename.lower().endswith(".gz"):
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
                raw = gz.read(MAX_SDAT_DECOMPRESSED_BYTES + 1)
        except Exception as exc:
            return _fail_early(log, ISSUE_GZIP_ERROR, f"Could not decompress gzip file: {exc}")
        if len(raw) > MAX_SDAT_DECOMPRESSED_BYTES:
            return _fail_early(
                log,
                ISSUE_DECOMPRESSED_TOO_LARGE,
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
        return _fail_early(log, ISSUE_MALFORMED_XML, f"Malformed SDAT-CH XML: {exc}")

    root_name = _local(root.tag)
    root_ns = root.tag.rsplit("}", 1)[0][1:] if "}" in root.tag else ""

    # Strict policy: only the current schema version is parsed; anything else is a named rejection.
    if root_name == STRICT_ROOT and root_ns == SDAT_NS:
        pass
    elif root_name == STRICT_ROOT:
        return _fail_early(
            log,
            ISSUE_UNSUPPORTED_ROOT,
            f"Wrong XML namespace '{root_ns or '?'}'; expected '{SDAT_NS}'. Nothing was imported.",
        )
    elif root_name.startswith("ValidatedMeteredData_"):
        return _fail_early(
            log,
            ISSUE_UNSUPPORTED_SCHEMA_VERSION,
            f"Schema version {root_name} is not supported; only {STRICT_ROOT} (SDAT-CH 2025, 15-minute active energy) is imported. Nothing was imported.",
        )
    elif root_name.startswith("AggregatedMeteredData_"):
        detail = "AggregatedMeteredData holds grid-area/balance-group sums, not per-meter data."
        return _fail_early(
            log,
            ISSUE_UNSUPPORTED_ROOT,
            f"Not a ValidatedMeteredData (E66) file. {detail} Nothing was imported.",
        )
    elif root_name.startswith("ImbalanceData_"):
        detail = "ImbalanceData holds balance-settlement series, not per-meter data."
        return _fail_early(
            log,
            ISSUE_UNSUPPORTED_ROOT,
            f"Not a ValidatedMeteredData (E66) file. {detail} Nothing was imported.",
        )
    else:
        detail = f"Unsupported root element '{root_name}'."
        return _fail_early(
            log,
            ISSUE_UNSUPPORTED_ROOT,
            f"Not a ValidatedMeteredData (E66) file. {detail} Nothing was imported.",
        )

    try:
        schema = _load_schema_16()
    except Exception as exc:
        return _fail_early(log, ISSUE_SCHEMA_INVALID, f"Schema validation unavailable: {exc}")

    # Cancellations are detected before schema validation (the E66 schema only permits 9/5).
    pre_header = root.find(_qname("ValidatedMeteredData_HeaderInformation"))
    pre_instance = pre_header.find(_qname("InstanceDocument")) if pre_header is not None else None
    if pre_instance is not None and _text(pre_instance, "Status") == STATUS_CANCELLATION:
        return _fail_early(
            log, ISSUE_CANCELLATION_REJECTED, "Document Status is 1 (cancellation). Cancellations are not imported."
        )
    try:
        schema.assertValid(root)
    except etree.DocumentInvalid as exc:
        return _fail_early(log, ISSUE_SCHEMA_INVALID, f"Schema validation failed: {exc}")

    try:
        delivery, reason, creation, is_replace = _validate_header(run, root)
    except _FileRejected as rejected:
        run.issues.extend(rejected.issues)
        return _fail_log(log, run)

    delivery_id = delivery["delivery_id"]

    # Phase 1: parse every block (no writes, no DB reads yet).
    run.rows_total = sum(1 for _ in root.iter(_qname("Observation")))
    blocks = []
    excluded_notes = []
    try:
        for md in root.iter(_qname("MeteringData")):
            outcome = _parse_block(md, reason=reason)
            if outcome[0] == "excluded":
                _, count, note = outcome
                run.counts["excluded"] += count
                excluded_notes.append(note)
            else:
                _, block = outcome
                blocks.append(block)
    except _FileRejected as rejected:
        run.issues.extend(rejected.issues)
        run.counts["rejected"] = run.rows_total - run.counts["excluded"]
        return _fail_log(log, run)
    for note in excluded_notes:
        run.add_issue(note["code"], note["message"], severity="info",
                      **{k: v for k, v in note.items() if k not in ("code", "severity", "message")})

    if not blocks and not excluded_notes:
        run.add_issue(ISSUE_EMPTY_DELIVERY, "Delivery carries no MeteringData blocks. Nothing was imported.")
        return _fail_log(log, run)

    # Phase 2: resolve meter identities; collect every failure before rejecting.
    resolution_issues = []
    for block in blocks:
        observed = block.observations[0].meter_id if block.observations else ""
        try:
            point = resolve_metering_point(zev, observed)
        except AmbiguousMeterIdentity as exc:
            resolution_issues.append(
                _issue(
                    ISSUE_AMBIGUOUS_METER,
                    f"Meter identity '{exc.identity}' matches several metering points; "
                    f"observations cannot be attributed without guessing; file rejected.",
                    meter_id=exc.identity,
                    block_id=block.document_id,
                )
            )
            continue
        if point is None:
            resolution_issues.append(
                _issue(
                    ISSUE_UNKNOWN_METER,
                    f"Metering point '{observed or '?'}' not found in this ZEV; file rejected.",
                    meter_id=observed or "?",
                    block_id=block.document_id,
                )
            )
            continue
        for obs in block.observations:
            obs.metering_point = point
    if resolution_issues:
        for issue in resolution_issues:
            run.add_issue(issue["code"], issue["message"],
                          **{k: v for k, v in issue.items() if k not in ("code", "severity", "message")})
        run.counts["rejected"] = sum(len(b.observations) for b in blocks)
        return _fail_log(log, run)

    # Phase 3: within-file slot conflicts.
    try:
        seen_slots = {}
        for block in blocks:
            for obs in block.observations:
                key = (obs.metering_point.pk, obs.timestamp, obs.direction)
                previous = seen_slots.get(key)
                if previous is not None:
                    prev_block, prev_energy = previous
                    if prev_energy != obs.energy:
                        raise _FileRejected(
                            [
                                _issue(
                                    ISSUE_CONFLICTING_POSITION,
                                    f"Slot {obs.timestamp.isoformat()} ({obs.direction}) for meter '{obs.meter_id}' "
                                    f"is delivered twice with conflicting values (blocks '{prev_block}' and "
                                    f"'{obs.block_id}'); file rejected.",
                                    meter_id=obs.meter_id,
                                    position_timestamp=obs.timestamp.isoformat(),
                                    direction=obs.direction,
                                )
                            ]
                        )
                    raise _FileRejected(
                        [
                            _issue(
                                ISSUE_DUPLICATE_POSITION,
                                f"Slot {obs.timestamp.isoformat()} ({obs.direction}) for meter '{obs.meter_id}' "
                                f"is delivered twice (blocks '{prev_block}' and '{obs.block_id}'); file rejected.",
                                meter_id=obs.meter_id,
                                position_timestamp=obs.timestamp.isoformat(),
                                direction=obs.direction,
                            )
                        ]
                    )
                seen_slots[key] = (obs.block_id, obs.energy)
    except _FileRejected as rejected:
        run.issues.extend(rejected.issues)
        run.counts["rejected"] = sum(len(b.observations) for b in blocks)
        return _fail_log(log, run)

    # Phase 4: atomic compare + write (one retry on write races).
    try:
        last_error = None
        for _attempt in (1, 2):
            try:
                with transaction.atomic():
                    _lock_zev_imports(zev)
                    attempt_run = _ImportRun()
                    attempt_run.rows_total = run.rows_total
                    attempt_run.counts["excluded"] = run.counts["excluded"]
                    attempt_run.issues = list(run.issues)
                    attempt_run.warnings = list(run.warnings)
                    attempt_run.delivery = run.delivery
                    changes, changes_truncated = _apply_plan(
                        batch_id=batch_id,
                        blocks=blocks,
                        reason=reason,
                        creation=creation,
                        delivery_id=delivery_id,
                        is_replace=is_replace,
                        run=attempt_run,
                    )
                    run.counts = attempt_run.counts
                    run.issues = attempt_run.issues
                    # Invoice flags join the same transaction: flags and reading
                    # changes commit or roll back together.
                    from invoices.reading_impact import flag_import_impacts

                    flag_import_impacts(
                        zev=zev,
                        import_log=log,
                        changes=changes,
                        changes_truncated=changes_truncated,
                        delivery=run.delivery,
                    )
                    if run.counts["created"] + run.counts["overwritten"] > 0:
                        status = SdatResultStatus.ACCEPTED
                    elif run.counts["held"] > 0:
                        status = SdatResultStatus.HELD
                    else:
                        status = SdatResultStatus.UNCHANGED
                        if run.counts["stale"] > 0:
                            run.add_issue(
                                ISSUE_STALE_SUPERSEDED,
                                f"Skipped {run.counts['stale']} observations superseded by newer deliveries; nothing changed.",
                                severity="info",
                                stale=run.counts["stale"],
                            )
                        elif run.counts["duplicate"] > 0:
                            run.add_issue(
                                ISSUE_DUPLICATE_DELIVERY,
                                f"Skipped {run.counts['duplicate']} observations already imported; nothing changed.",
                                severity="info",
                                duplicate=run.counts["duplicate"],
                            )
                    _add_legacy_warnings(run)
                    _finalize_log(log, run, status=status, changes=changes, changes_truncated=changes_truncated)
                return log
            except _FileRejected as rejected:
                # The atomic block rolled back: zero observation writes.
                run.issues.extend(rejected.issues)
                run.counts["rejected"] = sum(len(b.observations) for b in blocks)
                return _fail_log(log, run)
            except IntegrityError as exc:
                last_error = exc
                continue
        run.add_issue(
            ISSUE_SOURCE_CONFLICT,
            f"Concurrent write conflict while committing; file rejected without changes ({last_error}).",
        )
        run.counts["rejected"] = sum(len(b.observations) for b in blocks)
        return _fail_log(log, run)
    except Exception as exc:  # noqa: BLE001 — the endpoint contract is "always a log".
        run.add_issue(ISSUE_INTERNAL_ERROR, f"Import failed without writing observations: {type(exc).__name__}: {exc}")
        run.counts["rejected"] = sum(len(b.observations) for b in blocks)
        return _fail_log(log, run)


def _add_legacy_warnings(run):
    """Human-readable summary notes kept for the existing protocol display."""
    held = run.counts["held"]
    promoted = run.counts["promoted"]
    if held or promoted:
        run.warnings.append(
            {
                "warning": (
                    f"Quarantined {held} info-only/temporary observations "
                    f"(not billable); promoted {promoted} to billing."
                )
            }
        )
    for issue in run.issues:
        if issue.get("severity") == "info" and issue.get("code") in (
            ISSUE_REACTIVE_EXCLUDED,
            ISSUE_LEG_EXCLUDED,
            ISSUE_EXCHANGE_EXCLUDED,
        ):
            run.warnings.append({"warning": issue["message"]})
