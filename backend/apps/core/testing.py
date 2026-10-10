"""Small helpers shared by tests of the accounts/core/notifications apps."""

from __future__ import annotations

from rest_framework.test import APIClient


def client_for(user=None) -> APIClient:
    """A fresh API client (own cookie jar), optionally logged in as `user` via a real server-side session."""
    client = APIClient()
    if user is not None:
        client.force_login(user)
    return client
