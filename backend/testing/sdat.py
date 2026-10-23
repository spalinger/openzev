"""Synthetic E66 deliveries shared by metering, invoice and archive tests."""

import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal

CONS_ID = "CH9999901234500000000000000000001"
PROD_ID = "CH9999901234500000000000000000002"

TS0 = datetime(2025, 6, 2, 22, 0, tzinfo=timezone.utc)

ACTIVE_PRODUCT = "8716867000030"
REACTIVE_PRODUCT = "8716867000047"
LEG_PRODUCT = "2404050010123"


def observation(seq, volume, condition=None):
    cond = f"<rsm:Condition>{condition}</rsm:Condition>" if condition else ""
    return (
        f"<rsm:Observation><rsm:Position><rsm:Sequence>{seq}</rsm:Sequence></rsm:Position>"
        f"<rsm:Volume>{volume}</rsm:Volume>{cond}</rsm:Observation>"
    )


def _full_day_obs(temp="100", estimated="101", base=Decimal("102")):
    """96 observations: seq1 temporary, seq2 estimated, rest measured."""
    out = [observation(1, temp, "21"), observation(2, estimated, "56")]
    for seq in range(3, 97):
        out.append(observation(seq, str(base + seq)))
    return "".join(out)


def build_e66(
    blocks,
    *,
    reason_xml='<rsm:ebIXCode>E88</rsm:ebIXCode>',
    status="9",
    creation="2025-06-05T15:40:05Z",
    delivery_id="DERIVED-DOC",
    doctype="E66",
    root="ValidatedMeteredData_16",
    namespace="http://www.strom.ch",
    report_start=None,
    report_end=None,
):
    """Build a (usually schema-valid) E66 delivery. ``blocks`` are raw
    ``<rsm:MeteringData>`` strings from ``build_block`` or literal XML."""
    blocks = list(blocks)
    timestamps = []
    for value in re.findall(r"<rsm:(?:StartDateTime|EndDateTime)>([^<]+)</rsm:", "".join(blocks)):
        try:
            timestamps.append(datetime.fromisoformat(value.replace("Z", "+00:00")))
        except ValueError:
            pass
    report_start = report_start or (min(timestamps).strftime("%Y-%m-%dT%H:%M:%SZ") if timestamps else "2025-06-02T22:00:00Z")
    report_end = report_end or (max(timestamps).strftime("%Y-%m-%dT%H:%M:%SZ") if timestamps else "2025-06-03T22:00:00Z")
    return f"""<?xml version='1.0' encoding='UTF-8'?>
<rsm:{root} xmlns:rsm="{namespace}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="{namespace} ValidatedMeteredData_1p6.xsd">
\t<rsm:ValidatedMeteredData_HeaderInformation>
\t\t<rsm:HeaderVersion>1.0</rsm:HeaderVersion>
\t\t<rsm:Sender>
\t\t\t<rsm:ID>
\t\t\t\t<rsm:EICID schemeAgencyID="305">12X-PARTY-A-000K</rsm:EICID>
\t\t\t</rsm:ID>
\t\t\t<rsm:Role>MDR</rsm:Role>
\t\t</rsm:Sender>
\t\t<rsm:Receiver>
\t\t\t<rsm:ID>
\t\t\t\t<rsm:EICID schemeAgencyID="305">12X-PARTY-C-0008</rsm:EICID>
\t\t\t</rsm:ID>
\t\t\t<rsm:Role>DEC</rsm:Role>
\t\t</rsm:Receiver>
\t\t<rsm:InstanceDocument>
\t\t\t<rsm:DictionaryAgencyID>260</rsm:DictionaryAgencyID>
\t\t\t<rsm:VersionID listAgencyID="260">2007B</rsm:VersionID>
\t\t\t<rsm:DocumentID>{delivery_id}</rsm:DocumentID>
\t\t\t<rsm:DocumentType listAgencyID="260">
\t\t\t\t<rsm:ebIXCode>{doctype}</rsm:ebIXCode>
\t\t\t</rsm:DocumentType>
\t\t\t<rsm:Creation>{creation}</rsm:Creation>
\t\t\t<rsm:Status>{status}</rsm:Status>
\t\t</rsm:InstanceDocument>
\t\t<rsm:BusinessScopeProcess>
\t\t\t<rsm:BusinessReasonType codeListAgency="260">
\t\t\t\t{reason_xml}</rsm:BusinessReasonType>
\t\t\t<rsm:BusinessDomainType listAgencyID="260">E02</rsm:BusinessDomainType>
\t\t\t<rsm:BusinessSectorType>23</rsm:BusinessSectorType>
\t\t\t<rsm:ReportPeriod>
\t\t\t\t<rsm:StartDateTime>{report_start}</rsm:StartDateTime>
\t\t\t\t<rsm:EndDateTime>{report_end}</rsm:EndDateTime>
\t\t\t</rsm:ReportPeriod>
\t\t\t<rsm:BusinessService>
\t\t\t\t<rsm:ServiceTransaction isIntelligibleCheckRequired="true"/>
\t\t\t</rsm:BusinessService>
\t\t</rsm:BusinessScopeProcess>
\t</rsm:ValidatedMeteredData_HeaderInformation>
\t{''.join(blocks)}
\t</rsm:{root}>
""".encode()


def build_block(
    meter_id,
    observations,
    *,
    doc="DERIVED-BLOCK",
    point="ConsumptionMeteringPoint",
    start="2025-06-02T22:00:00Z",
    end="2025-06-02T23:00:00Z",
    resolution="15",
    resolution_unit="MIN",
    product=ACTIVE_PRODUCT,
    product_scheme="ebIXCode",
    product_agency="9",
    unit="KWH",
    omit_resolution=False,
    omit_interval=False,
    omit_point=False,
):
    """Build one MeteringData block. ``observations`` is a raw string; the
    caller owns interval/observation agreement (default: 4 slots, one hour)."""
    interval = ""
    if not omit_interval:
        interval = (
            f"<rsm:Interval><rsm:StartDateTime>{start}</rsm:StartDateTime>"
            f"<rsm:EndDateTime>{end}</rsm:EndDateTime></rsm:Interval>"
        )
    resolution_xml = ""
    if not omit_resolution:
        resolution_xml = (
            f"<rsm:Resolution><rsm:Resolution>{resolution}</rsm:Resolution>"
            f"<rsm:Unit>{resolution_unit}</rsm:Unit></rsm:Resolution>"
        )
    if omit_point:
        point_xml = ""
    elif point == "ExchangeMeteringPoint":
        point_xml = (
            f"<rsm:ExchangeMeteringPoint>"
            f"<rsm:VSENationalID schemeID=\"VSE\" schemeAgencyID=\"260\">{meter_id}</rsm:VSENationalID>"
            f"<rsm:Direction><rsm:InArea>"
            f"<rsm:EICID schemeAgencyID=\"305\">12Y-AREA-A-00009</rsm:EICID>"
            f"</rsm:InArea><rsm:OutArea>"
            f"<rsm:EICID schemeAgencyID=\"305\">12Y-AREA-C-0000W</rsm:EICID>"
            f"</rsm:OutArea></rsm:Direction>"
            f"</rsm:ExchangeMeteringPoint>"
        )
    else:
        point_xml = (
            f"<rsm:{point}><rsm:VSENationalID schemeID=\"VSE\" "
            f"schemeAgencyID=\"260\">{meter_id}</rsm:VSENationalID></rsm:{point}>"
        )
    return (
        f"<rsm:MeteringData><rsm:DocumentID>{doc}</rsm:DocumentID>{interval}"
        f"{resolution_xml}{point_xml}"
        f"<rsm:Product><rsm:ID><rsm:{product_scheme} schemeAgencyID=\"{product_agency}\">"
        f"{product}</rsm:{product_scheme}></rsm:ID>"
        f"<rsm:MeasureUnit>{unit}</rsm:MeasureUnit></rsm:Product>"
        f"{observations}</rsm:MeteringData>"
    )


def quarter_block(meter_id, start, count, *, doc="DERIVED-BLOCK", point="ConsumptionMeteringPoint", **kwargs):
    """A complete 15-minute block of ``count`` measured observations."""
    start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    end = (start_dt + timedelta(minutes=15 * count)).strftime("%Y-%m-%dT%H:%M:%SZ")
    observations = "".join(observation(seq, str(100 + seq)) for seq in range(1, count + 1))
    return build_block(meter_id, observations, doc=doc, point=point, start=start, end=end, **kwargs)
