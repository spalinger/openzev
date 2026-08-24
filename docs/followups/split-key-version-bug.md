# split_key Lost on Tariff New-Version / Duplicate

Status: not yet started.

## Bug

**File:** `backend/tariffs/views.py:198-209` (new_version) and `:261-272` (duplicate)

Both `new_version()` and `duplicate()` construct the new `Tariff(...)` copying every field
except `split_key`, which falls back to the model default `'equal'`.

The frontend can't compensate: `TariffVersionModal.buildPayload()` sends only dates/prices/periods,
and `SERIES_FIELDS = ("category", "billing_mode", "energy_type")` excludes it, so `Tariff.clean()`
won't flag the drift either.

**Net effect:** a shared fee configured "by weight" reverts to headcount split for every invoice
issued under the new version — silently wrong money.

No test covers `split_key` propagation through versioning.

## Fix

Add `split_key=source.split_key` to the `Tariff(...)` constructor calls in both
`new_version` and `duplicate`. Add tests asserting split_key is preserved.
