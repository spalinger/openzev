"""Test-only settings.

Imports the full production configuration and overrides only what makes the
suite faster without changing behaviour under test. Kept separate so production
password security is never weakened.
"""
from .settings import *  # noqa: F401,F403

# The default PBKDF2 hasher runs ~600k iterations per password; the suite creates
# well over a hundred users, so hashing dominates the run time. Tests don't need
# real password security — MD5 cuts the full suite from minutes to well under one.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
