import pytest
from django.http import FileResponse, HttpResponse

from config.http import content_disposition, sanitize_filename


class TestContentDisposition:
    def test_attachment_ascii(self):
        assert content_disposition("attachment", "invoices-2026-01-01.zip") == (
            'attachment; filename="invoices-2026-01-01.zip"'
        )

    def test_quote_in_filename_is_escaped(self):
        header = content_disposition("attachment", 'contract_"Muster".pdf')
        assert header == 'attachment; filename="contract_\\"Muster\\".pdf"'

    def test_non_ascii_gets_rfc5987_fallback(self):
        header = content_disposition("attachment", "Verträge-Müller.pdf")
        assert "filename*=" in header
        assert "filename*=utf-8''Vertr%C3%A4ge-M%C3%BCller.pdf" in header

    def test_unknown_disposition_raises(self):
        with pytest.raises(ValueError):
            content_disposition("Attachment", "x.pdf")

    @pytest.mark.parametrize("filename", ['contract_Mu\r\nller.pdf', 'INV\x00\t\x7f-2026.pdf'])
    def test_control_characters_do_not_break_download_headers(self, filename):
        response = HttpResponse()
        response["Content-Disposition"] = content_disposition("attachment", filename)
        assert all(ord(char) >= 32 and ord(char) != 127 for char in response["Content-Disposition"])

    def test_file_response_sanitizes_before_constructing_its_automatic_header(self):
        import io

        file = io.BytesIO(b"%PDF")
        file.name = "legacy\r\nname.pdf"
        response = FileResponse(file, filename=sanitize_filename(file.name))
        assert response["Content-Disposition"] == 'inline; filename="legacyname.pdf"'

    def test_filename_made_only_of_controls_has_a_usable_fallback(self):
        assert sanitize_filename("\r\n\x00") == "download"

    def test_path_separators_cannot_escape_an_archive_entry_or_download_name(self):
        assert sanitize_filename("../INV\\x-1.pdf") == ".._INV_x-1.pdf"
