import pytest

from config.safe_format import render_with_fallback, safe_format


class TestSafeFormat:
    def test_bare_placeholder_renders(self):
        assert safe_format("Hello {name}", {"name": "Li"}) == "Hello Li"

    def test_normal_formatting_and_conversions_are_preserved(self):
        assert safe_format("{amount:>10.2f} {name!r}", {"amount": 12.34, "name": "Li"}) == "     12.34 'Li'"

    @pytest.mark.parametrize("spec", ["100000", ".100000f", "{width}"])
    def test_excessive_format_spec_is_rejected_before_formatting(self, spec):
        class NeverFormatted:
            def __format__(self, spec):
                raise AssertionError("Formatting must not allocate first")

        assert render_with_fallback(
            "{value:" + spec + "}", "Default", {"value": NeverFormatted(), "width": 100000},
        ) == "Default"

    def test_long_templates_fall_back(self):
        from config.safe_format import MAX_TEMPLATE_CHARACTERS

        assert render_with_fallback("x" * (MAX_TEMPLATE_CHARACTERS + 1), "Default", {}) == "Default"

    def test_attribute_traversal_raises(self):
        with pytest.raises(KeyError):
            safe_format("Hello {name.__class__}", {"name": "Li"})

    def test_item_traversal_raises(self):
        with pytest.raises(KeyError):
            safe_format("Hello {name[0]}", {"name": "Li"})

    def test_positional_field_falls_back(self):
        assert render_with_fallback("Hi {0}", "Hi {name}", {"name": "Li"}) == "Hi Li"

    def test_broken_default_fails_instead_of_returning_raw_placeholders(self):
        with pytest.raises(KeyError):
            render_with_fallback("{missing}", "Verify {verify_url}", {})

    def test_on_error_is_called_only_for_a_bad_template(self):
        errors = []
        assert render_with_fallback("Hi {name}", "Hey", {"name": "Li"}, on_error=errors.append) == "Hi Li"
        assert errors == []
        assert render_with_fallback("{nope}", "Hey {name}", {"name": "Li"}, on_error=errors.append) == "Hey Li"
        assert len(errors) == 1
