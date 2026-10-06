"""Network safety helpers for admin/user-configured outbound URLs."""
from __future__ import annotations

import ipaddress
import socket
import urllib.parse


class PublicHostError(ValueError):
    def __init__(self, message: str, *, reason: str = "not_public", log_detail: str | None = None):
        super().__init__(message)
        # "invalid_url" | "unresolved" | "not_public" — callers branch on this, not on the text.
        self.reason = reason
        self.log_detail = log_detail or message


def check_public_host(
    url: str, *, allowed_schemes=frozenset({"http", "https"}), allow_private: bool = False
) -> None:
    """Refuse URLs whose host resolves to a non-public address at validation time.

    This is not a connection-bound guard: the caller's HTTP client resolves the
    name again, so DNS rebinding remains possible. Restrict egress at the
    deployment level where that matters (this also covers requests that carry
    credentials, such as the OAuth token exchange).
    """
    # urlsplit's hostname/port properties can themselves raise for malformed URLs.
    try:
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise PublicHostError("The URL is invalid.", reason="invalid_url", log_detail=str(exc)) from exc
    if parsed.scheme not in allowed_schemes:
        raise PublicHostError(f"Unsupported URL scheme: {parsed.scheme or '(missing)'}", reason="invalid_url")
    if not host:
        raise PublicHostError("The URL has no host name.", reason="invalid_url")
    try:
        addresses = socket.getaddrinfo(host, port or (443 if parsed.scheme == "https" else 80))
    except UnicodeError as exc:  # e.g. a DNS label over 63 characters
        raise PublicHostError("The URL has an invalid host name.", reason="invalid_url", log_detail=str(exc)) from exc
    except socket.gaierror as exc:
        raise PublicHostError(f"Host could not be resolved: {host}", reason="unresolved") from exc
    if not addresses:
        raise PublicHostError(f"Host could not be resolved: {host}", reason="unresolved")
    if allow_private:
        return
    for _family, _type, _proto, _canonname, sockaddr in addresses:
        address = ipaddress.ip_address(sockaddr[0])
        # Some multicast scopes count as global, so refuse them explicitly.
        if not address.is_global or address.is_multicast:
            raise PublicHostError(
                "Host does not resolve to a public address.",
                log_detail=f"{host!r} resolved to {address}, which is not globally routable.",
            )
