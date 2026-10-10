import itertools
from datetime import timedelta

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from tests.factories import make_user

pytestmark = pytest.mark.django_db

URL = "/api/v1/notifications/"
_n = itertools.count(1)


@pytest.fixture(autouse=True)
def _clean_cache():
    cache.clear()
    yield
    cache.clear()


def client_for(user):
    client = APIClient()
    client.force_login(user)
    return client


def notify(user, *, read=False, order=None, age_minutes=0, kind="order_confirmed"):
    n = next(_n)
    note = Notification.objects.create(user=user, order=order, kind=kind, title=f"Title {n}", body="Body", is_read=read)
    Notification.objects.filter(pk=note.pk).update(created_at=timezone.now() - timedelta(minutes=age_minutes))
    return note


def make_order_for(user):
    from decimal import Decimal

    from apps.orders.models import Order
    from tests.factories import make_branch

    return Order.objects.create(
        number=f"N-{next(_n):06d}",
        customer=user,
        branch=make_branch(),
        order_type="PICKUP",
        currency="USD",
        payment_method="cash",
        subtotal=Decimal("5"),
        total=Decimal("5"),
        customer_name="x",
        customer_email=user.email,
        idempotency_key=f"k{next(_n)}",
        placed_at=timezone.now(),
    )


class TestAuth:
    @pytest.mark.parametrize(
        "method,suffix",
        [("get", ""), ("get", "unread-count/"), ("post", "read-all/"), ("get", "1/"), ("post", "1/read/")],
    )
    def test_anonymous_gets_401(self, method, suffix):
        res = getattr(APIClient(), method)(URL + suffix)
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "not_authenticated"


class TestList:
    def test_only_mine_newest_first_paginated(self):
        me, other = make_user(), make_user()
        order = make_order_for(me)
        old = notify(me, age_minutes=30)
        new = notify(me, order=order, age_minutes=1)
        notify(other)
        res = client_for(me).get(URL)
        assert res.status_code == 200
        body = res.json()
        assert set(body) == {"count", "next", "previous", "results"} and body["count"] == 2
        assert [r["id"] for r in body["results"]] == [new.pk, old.pk]
        assert body["results"][0]["order_number"] == order.number and body["results"][1]["order_number"] is None
        assert set(body["results"][0]) == {"id", "kind", "title", "body", "is_read", "order_number", "created_at"}

    def test_pagination_and_unread_filter(self):
        me = make_user()
        for i in range(5):
            notify(me, read=i % 2 == 0, age_minutes=i)
        client = client_for(me)
        page = client.get(URL, {"page_size": 2}).json()
        assert page["count"] == 5 and len(page["results"]) == 2 and page["next"]
        unread = client.get(URL, {"unread": "true"}).json()
        assert unread["count"] == 2 and all(not r["is_read"] for r in unread["results"])

    def test_unread_count_and_me(self):
        me, other = make_user(), make_user()
        notify(me)
        notify(me)
        notify(me, read=True)
        notify(other)
        client = client_for(me)
        assert client.get(URL + "unread-count/").json() == {"count": 2}
        assert client.get("/api/v1/auth/me/").json()["unread_notifications"] == 2


class TestMarkRead:
    def test_mark_one(self):
        me = make_user()
        note = notify(me)
        client = client_for(me)
        res = client.post(f"{URL}{note.pk}/read/")
        assert res.status_code == 200 and res.json()["is_read"] is True
        note.refresh_from_db()
        assert note.is_read
        assert client.post(f"{URL}{note.pk}/read/").status_code == 200  # idempotent
        assert client.get(URL + "unread-count/").json() == {"count": 0}

    def test_foreign_notification_is_404_and_untouched(self):
        owner, intruder = make_user(), make_user()
        note = notify(owner)
        client = client_for(intruder)
        assert client.post(f"{URL}{note.pk}/read/").status_code == 404
        assert client.get(f"{URL}{note.pk}/").status_code == 404
        note.refresh_from_db()
        assert not note.is_read

    def test_unknown_and_malformed_ids(self):
        client = client_for(make_user())
        assert client.post(f"{URL}999999/read/").status_code == 404
        assert client.post(f"{URL}abc/read/").status_code == 404

    def test_read_all_only_touches_my_notifications(self):
        me, other = make_user(), make_user()
        notify(me)
        notify(me)
        theirs = notify(other)
        res = client_for(me).post(URL + "read-all/")
        assert res.status_code == 200 and res.json() == {"updated": 2}
        assert Notification.objects.filter(user=me, is_read=False).count() == 0
        theirs.refresh_from_db()
        assert not theirs.is_read
        assert client_for(me).post(URL + "read-all/").json() == {"updated": 0}

    def test_cannot_create_or_delete_via_api(self):
        me = make_user()
        note = notify(me)
        client = client_for(me)
        assert client.post(URL, {"title": "x"}, format="json").status_code == 405
        assert client.delete(f"{URL}{note.pk}/").status_code == 405
        assert client.patch(f"{URL}{note.pk}/", {"is_read": True}, format="json").status_code == 405
