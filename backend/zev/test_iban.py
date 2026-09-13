"""Direct vectors for the dependency-free IBAN helpers.

API-level coverage (wizard rejection, normalized persistence, blank-IBAN
readiness) lives in `zev/tests.py` and `invoices/test_readiness.py`; these
pin the helpers themselves: compact-uppercase normalization, the ISO 13616
MOD-97 checksum, and the blank-means-absent (invalid, not an error) rule.
"""

from django.test import SimpleTestCase

from zev.iban import INVALID_IBAN_MESSAGE, is_valid_iban, normalize_iban


class NormalizeIbanTests(SimpleTestCase):
    def test_strips_whitespace_and_uppercases(self):
        self.assertEqual(normalize_iban("CH93 0076 2011 6238 5295 7"), "CH9300762011623852957")

    def test_lowercase_with_mixed_whitespace(self):
        self.assertEqual(normalize_iban("  ch93\t0076\n2011 6238 5295 7  "), "CH9300762011623852957")

    def test_empty_stays_empty(self):
        self.assertEqual(normalize_iban(""), "")
        self.assertEqual(normalize_iban("   "), "")


class IsValidIbanTests(SimpleTestCase):
    def test_known_valid_ibans(self):
        self.assertTrue(is_valid_iban("CH9300762011623852957"))
        self.assertTrue(is_valid_iban("CH4431999123000889012"))
        self.assertTrue(is_valid_iban("DE89370400440532013000"))

    def test_spaced_and_lowercase_forms_validate(self):
        self.assertTrue(is_valid_iban("CH93 0076 2011 6238 5295 7"))
        self.assertTrue(is_valid_iban("ch93 0076 2011 6238 5295 7"))

    def test_wrong_checksum_rejected(self):
        self.assertFalse(is_valid_iban("CH9300762011623852956"))

    def test_wrong_length_rejected(self):
        self.assertFalse(is_valid_iban("CH93"))
        self.assertFalse(is_valid_iban("CH93007620116238529571234567890123"))

    def test_non_ascii_rejected(self):
        self.assertFalse(is_valid_iban("CH93 0076 2011 6238 5295 é"))

    def test_blank_is_absent_not_an_error(self):
        # Blank means "no IBAN configured": invalid for readiness purposes,
        # but never a validation error — serializers/models skip blank values.
        self.assertFalse(is_valid_iban(""))
        self.assertFalse(is_valid_iban("   "))


class IbanMessageTests(SimpleTestCase):
    def test_shared_message_mentions_leaving_blank(self):
        self.assertIn("leave this field empty", INVALID_IBAN_MESSAGE)
