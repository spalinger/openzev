"""Authentication helpers shared across the test suite.

The project authenticates with JWT delivered via httpOnly cookies, but
``CookieJWTAuthentication`` also accepts a standard ``Authorization: Bearer``
header. For tests we mint a token directly and set the header on the client,
which avoids an extra HTTP round-trip through the login endpoint.
"""

from __future__ import annotations

from rest_framework_simplejwt.tokens import RefreshToken


def authenticate(client, user) -> None:
    """Authenticate ``client`` as ``user`` via a Bearer token.

    Mirrors the production ``CookieJWTAuthentication`` header fallback so test
    clients can authenticate without driving the full cookie-based login flow.
    """
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")


def access_token_for(user) -> str:
    """Return a raw access token string for ``user`` (useful for cookie tests)."""
    return str(RefreshToken.for_user(user).access_token)
