# Vendored SDAT-CH XML schemas (read-only)

Strict-validation bundle for the SDAT-CH importer (see `sdatch_importer.py`).

- `ValidatedMeteredData_1p6.xsd` is the entry schema (SDAT-CH 2025,
  mandatory in Switzerland since 24.03.2026).
- The other 53 files are its transitive `xs:import`/`xs:include` closure
  (ebIX / UNECE / VSE code lists, eCH types), copied unchanged from the
  official VSE `Beispieldateien` archive so validation works offline
  (`no_network=True`); relative `schemaLocation` imports resolve from
  this directory.

© VSE/AES, ebIX, UNECE. Do not edit vendored files; replace the whole
directory when a new SDAT-CH edition ships.
