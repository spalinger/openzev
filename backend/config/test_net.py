import socket
from unittest.mock import patch

import pytest

from config.net import PublicHostError, check_public_host


def addresses(*ips):
    return [(socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443)) for ip in ips]


@pytest.mark.parametrize("ip", [
    "127.0.0.1", "10.0.0.1", "169.254.169.254", "0.0.0.0", "192.0.2.1",
    "100.64.0.1", "100.127.255.254", "224.0.0.1", "240.0.0.1",
    "::1", "::", "fc00::1", "fe80::1", "2001:db8::1", "ff02::1", "::ffff:127.0.0.1",
])
def test_non_public_addresses_are_refused_even_in_a_mixed_dns_answer(ip):
    with patch("config.net.socket.getaddrinfo", return_value=addresses("93.184.216.34", ip)):
        with pytest.raises(PublicHostError, match="public address"):
            check_public_host("https://operator.example/data")


def test_public_ipv4_and_ipv6_are_allowed():
    with patch("config.net.socket.getaddrinfo", return_value=addresses("93.184.216.34", "2606:4700:4700::1111")):
        check_public_host("https://operator.example/data")


@pytest.mark.parametrize("url", ["https://operator.example:bogus/data", "https://operator.example:65536/data", "https://[broken/data"])
def test_malformed_urls_fail_before_resolution(url):
    with patch("config.net.socket.getaddrinfo") as resolver:
        with pytest.raises(PublicHostError, match="invalid"):
            check_public_host(url)
        resolver.assert_not_called()


def test_no_resolved_addresses_is_not_public():
    with patch("config.net.socket.getaddrinfo", return_value=[]):
        with pytest.raises(PublicHostError, match="resolved"):
            check_public_host("https://operator.example/data")


def test_overlong_dns_label_is_an_invalid_url_not_a_unicode_error():
    with pytest.raises(PublicHostError, match="invalid host") as caught:
        check_public_host("https://" + "x" * 64 + ".example/data")
    assert caught.value.reason == "invalid_url"
