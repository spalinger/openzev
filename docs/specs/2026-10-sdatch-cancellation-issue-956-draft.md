# Issue #956: proposed comment

Local draft for [#956](https://github.com/splattner/openzev/issues/956).
Replace this file with the posted comment's link after agreement.

---

I recommend retaining rejection of `Status=1` for the standard E66 importer.
Cancellation tombstones and automatic billing blocks remain out of scope.
Please confirm before treating that part of #956 as resolved; do not close it
as an implemented cancellation feature.

Anhang 2 §2 limits cancellation to switching and directs metering errors to
updates. Messdatenaustauschprozesse §1.2 uses new replacement messages, and the
vendored E66 1p6 schema allows only `9` and `5`.
See the [reviewed evidence and full rationale](https://github.com/spalinger/openzev/blob/3c712f044aa73f5202eeca9c5a4704ee0f17ccee/docs/specs/2026-03-metering-import-and-quality.md#42-sdat-ch-ebix-xml-importer).

A rejected upload changes no observations; it does not establish that stored
readings are correct. There is no manual billing-period hold, quarantine does
not invalidate accepted readings, and invoice review flags are advisory.
Request a `Status=5` correction or written clarification from the sender; the
recommended response is to defer billing while the concern remains unresolved.
Any cancellation extension needs an agreed partner profile and separate spec.
