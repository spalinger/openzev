import uuid


class AuditRequestContextMiddleware:
    """Attach request-level metadata used by the audit service."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.audit_request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.audit_ip_address = self._extract_ip(request)
        request.audit_user_agent = (request.META.get("HTTP_USER_AGENT") or "")[:500]
        request.audit_source = "api"
        return self.get_response(request)

    @staticmethod
    def _extract_ip(request):
        forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded_for:
            # Only trust the left-most IP value for audit display.
            return forwarded_for.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR")
