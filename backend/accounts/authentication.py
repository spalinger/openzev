from rest_framework_simplejwt.authentication import JWTAuthentication

ACCESS_COOKIE = "openzev_access"


class CookieJWTAuthentication(JWTAuthentication):
    """JWT authentication that reads the access token from an httpOnly cookie.

    Falls back to the standard Authorization header so API clients and existing
    tooling (e.g. drf-spectacular, curl) continue to work without changes.
    """

    def authenticate(self, request):
        # Prefer the Authorization header (API clients / backward-compat)
        header = self.get_header(request)
        if header:
            return super().authenticate(request)

        # Fall back to the httpOnly cookie set by the login endpoint
        raw_token = request.COOKIES.get(ACCESS_COOKIE)
        if raw_token is None:
            return None

        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token
