"""Auth cookie names and helpers. ``set_auth_cookies`` also issues the CSRF cookie."""

from datetime import timedelta

from django.conf import settings
from django.middleware.csrf import get_token

ACCESS_COOKIE = "openzev_access"
REFRESH_COOKIE = "openzev_refresh"
ADMIN_ACCESS_COOKIE = "openzev_admin_access"
ADMIN_REFRESH_COOKIE = "openzev_admin_refresh"

#: Proves an OAuth callback is presented by the browser that started the flow.
#: Scoped to the OAuth endpoints so it is not sent anywhere else.
OAUTH_BINDING_COOKIE = "openzev_oauth_binding"
OAUTH_BINDING_PATH = "/api/v1/auth/oauth/"


def _cookie_kwargs() -> dict:
    """Shared kwargs for all auth cookies: httpOnly, Secure in prod, SameSite=Lax."""
    return {
        "httponly": True,
        "samesite": "Lax",
        "secure": not settings.DEBUG,
        "path": "/",
    }


def set_auth_cookies(
    request,
    response,
    *,
    access: str,
    refresh: str,
    access_cookie: str = ACCESS_COOKIE,
    refresh_cookie: str = REFRESH_COOKIE,
) -> None:
    jwt_settings = settings.SIMPLE_JWT
    access_max_age = int(jwt_settings.get("ACCESS_TOKEN_LIFETIME", timedelta(minutes=60)).total_seconds())
    refresh_max_age = int(jwt_settings.get("REFRESH_TOKEN_LIFETIME", timedelta(days=7)).total_seconds())
    kw = _cookie_kwargs()
    response.set_cookie(access_cookie, access, max_age=access_max_age, **kw)
    response.set_cookie(refresh_cookie, refresh, max_age=refresh_max_age, **kw)
    get_token(request)  # CsrfViewMiddleware sets the cookie


def clear_auth_cookies(
    response,
    access_cookie: str = ACCESS_COOKIE,
    refresh_cookie: str = REFRESH_COOKIE,
) -> None:
    response.delete_cookie(access_cookie, path="/")
    response.delete_cookie(refresh_cookie, path="/")


def set_oauth_binding_cookie(response, binding: str, *, max_age: int) -> None:
    """Hand the initiating browser the secret that binds it to its OAuth state row.

    ``SameSite=Lax`` is deliberate and sufficient: the redirect back from the
    provider is a top-level GET navigation, which Lax sends the cookie on, while
    ``Strict`` would withhold it and break every login. There is no CSRF cookie
    here — the binding is not read by frontend code, so it stays ``HttpOnly``.
    """
    kwargs = _cookie_kwargs()
    kwargs["path"] = OAUTH_BINDING_PATH
    response.set_cookie(OAUTH_BINDING_COOKIE, binding, max_age=max_age, **kwargs)


def clear_oauth_binding_cookie(response) -> None:
    """Drop the binding on every callback exit path: success, refusal, error."""
    response.delete_cookie(OAUTH_BINDING_COOKIE, path=OAUTH_BINDING_PATH)
