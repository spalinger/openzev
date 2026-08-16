"""Pin the template field catalogs against their sample contexts.

The catalogs in ``field_catalog.py`` are curated lists: a future context
feature could ship without anyone noticing the reference does not know about
it. These tests make that impossible in both directions:

* every entry with a ``sample_path`` must resolve against the matching sample
  context (an unresolvable path means the catalog references a variable the
  preview/strict-validation would reject, or the sample context drifted), and
* every entry must produce a UI payload with the documented shape
  (``variable``, ``description_key``, optional ``example``).
"""

import re
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

from invoices.field_catalog import (
    EMAIL_FIELD_CATALOGS,
    EMAIL_SAMPLE_CONTEXTS,
    PDF_FIELD_CATALOGS,
    PDF_SAMPLE_CONTEXTS,
    _resolve_sample_path,
    email_field_catalog,
    pdf_field_catalog,
)


PDF_TEMPLATE_PATHS = {
    "invoice": "invoices/invoice_pdf.html",
    "contract": "contracts/participant_contract_pdf.html",
    "annual_statement": "invoices/annual_statement_pdf.html",
}


def _template_translation_keys(template_type):
    template_path = Path(settings.BASE_DIR) / "templates" / PDF_TEMPLATE_PATHS[template_type]
    template = template_path.read_text(encoding="utf-8")
    return set(re.findall(r"\{\{\s*tr\.([A-Za-z_][A-Za-z0-9_]*)\b[^}]*\}\}", template))


def _entries(catalog):
    for group in catalog:
        for entry in group["fields"]:
            yield entry


class PdfCatalogResolutionTests(SimpleTestCase):
    def test_every_sample_path_resolves_against_its_context(self):
        for template_type, groups in PDF_FIELD_CATALOGS.items():
            context = PDF_SAMPLE_CONTEXTS[template_type]()
            with self.subTest(template_type=template_type):
                for entry in _entries(groups):
                    with self.subTest(variable=entry["variable"]):
                        if entry.get("sample_path"):
                            value = _resolve_sample_path(entry["sample_path"], context)
                            # SVG entries render sample value None (no chart in
                            # the sample data); every other entry must resolve
                            # to a displayable example value.
                            if "|safe" not in entry["variable"]:
                                self.assertIsNotNone(value, "sample context value must be non-None")

    def test_resolved_examples_are_computed_not_hand_typed(self):
        """No entry in the PDF catalogs carries a literal example — the sample
        context is the single source of example values."""
        for template_type, groups in PDF_FIELD_CATALOGS.items():
            with self.subTest(template_type=template_type):
                for entry in _entries(groups):
                    self.assertNotIn("example", entry)

    def test_variables_are_unique_within_a_catalog(self):
        for template_type, groups in PDF_FIELD_CATALOGS.items():
            variables = [entry["variable"] for entry in _entries(groups)]
            with self.subTest(template_type=template_type):
                self.assertEqual(len(variables), len(set(variables)))

    def test_catalog_covers_concrete_translation_tokens_in_default_templates(self):
        for template_type, groups in PDF_FIELD_CATALOGS.items():
            catalog_variables = {entry["variable"] for entry in _entries(groups)}
            catalog_translation_variables = {
                variable.removeprefix("{{ ").removesuffix(" }}")
                for variable in catalog_variables
                if variable.startswith("{{ tr.")
            }
            with self.subTest(template_type=template_type):
                template_keys = _template_translation_keys(template_type)
                self.assertEqual(
                    {f"tr.{key}" for key in template_keys},
                    catalog_translation_variables,
                )

    def test_catalog_contains_the_newer_contract_fields(self):
        """The contract redesign shipped eight context fields the static UI
        reference never listed; the catalog must cover them."""
        variables = {entry["variable"] for entry in _entries(PDF_FIELD_CATALOGS["contract"])}
        for variable in (
            "{{ participation_start }}",
            "{{ document_id }}",
            "{{ vat_rate_display }}",
            "{{ tariff_rule }}",
            "{{ tariff_pct_line }}",
            "{{ tariff_reference_product }}",
            "{{ row.validity }}",
            "{{ zev.payment_term_days }}",
        ):
            with self.subTest(variable=variable):
                self.assertIn(variable, variables)


class EmailCatalogResolutionTests(SimpleTestCase):
    def test_every_sample_path_resolves_against_its_context(self):
        for template_key, groups in EMAIL_FIELD_CATALOGS.items():
            context = EMAIL_SAMPLE_CONTEXTS[template_key]()
            with self.subTest(template_key=template_key):
                for entry in _entries(groups):
                    with self.subTest(variable=entry["variable"]):
                        if entry.get("sample_path"):
                            value = _resolve_sample_path(entry["sample_path"], context)
                            self.assertIsNotNone(value, "sample context value must be non-None")

    def test_email_catalog_covers_the_send_time_contexts(self):
        """Every key the send-time code formats with must be insertable, and
        every catalog variable must be one the send-time context supports."""
        from .field_catalog import (  # noqa: PLC0415 (import order kept local on purpose)
            build_sample_invitation_email_context,
            build_sample_invoice_email_context,
            build_sample_verification_email_context,
        )

        builders = {
            "invoice_email": build_sample_invoice_email_context,
            "participant_invitation": build_sample_invitation_email_context,
            "email_verification": build_sample_verification_email_context,
        }
        for template_key, builder in builders.items():
            context = builder()
            variables = [entry["variable"] for entry in _entries(EMAIL_FIELD_CATALOGS[template_key])]
            expected = sorted("{" + key + "}" for key in context)
            with self.subTest(template_key=template_key):
                self.assertEqual(sorted(variables), expected)


class CatalogPayloadShapeTests(SimpleTestCase):
    def test_pdf_catalog_payload_has_the_ui_shape(self):
        for template_type in ("invoice", "contract", "annual_statement"):
            with self.subTest(template_type=template_type):
                for group in pdf_field_catalog(template_type):
                    self.assertIn("group_key", group)
                    self.assertIn("group_title_key", group)
                    self.assertIn("fields", group)
                    for entry in group["fields"]:
                        self.assertIn("variable", entry)
                        self.assertIn("description_key", entry)
                        self.assertTrue(entry["description_key"].startswith("admin."))

    def test_email_catalog_payload_has_the_ui_shape(self):
        for template_key in ("invoice_email", "participant_invitation", "email_verification"):
            with self.subTest(template_key=template_key):
                for group in email_field_catalog(template_key):
                    self.assertIsNone(group["group_title_key"])
                    for entry in group["fields"]:
                        self.assertTrue(entry["description_key"].startswith("admin."))

    def test_unknown_template_type_returns_empty_catalog(self):
        self.assertEqual(pdf_field_catalog("nonsense"), [])
        self.assertEqual(email_field_catalog("nonsense"), [])

    def test_example_values_match_the_preview(self):
        """Spot-check that example values equal what the preview renders."""
        catalog = {entry["variable"]: entry for entry in _entries(pdf_field_catalog("invoice"))}
        self.assertEqual(catalog["{{ participant.full_name }}"]["example"], "Hans Beispiel")
        self.assertEqual(catalog["{{ invoice.total_chf }}"]["example"], "486.45")
        self.assertEqual(catalog["{{ savings_data.saved_chf }}"]["example"], "12.82")
