import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Address
from apps.accounts.services import MAX_ACTIVE_ADDRESSES
from apps.core.testing import client_for
from tests.factories import make_address, make_user, make_zone

pytestmark = pytest.mark.django_db

URL = "/api/v1/addresses/"


def payload(**over):
    data = {
        "label": "Home",
        "recipient_name": "Ada Lovelace",
        "phone": "+1 555 010 0100",
        "line1": "12 Analytical Way",
        "city": "Londonderry",
        "postal_code": "AB1 2CD",
    }
    data.update(over)
    return data


def defaults(user):
    return list(Address.objects.filter(user=user, is_default=True, is_deleted=False).values_list("pk", flat=True))


class TestCrud:
    def test_anonymous_gets_401(self):
        assert APIClient().get(URL).status_code == 401
        assert APIClient().post(URL, payload(), format="json").status_code == 401

    def test_first_address_becomes_default(self):
        user = make_user()
        res = client_for(user).post(URL, payload(), format="json")
        assert res.status_code == 201
        body = res.json()
        assert body["is_default"] is True and body["zone"] is None and body["zone_name"] is None
        assert defaults(user) == [body["id"]]

    def test_second_address_is_not_default(self):
        user = make_user()
        client = client_for(user)
        first = client.post(URL, payload(), format="json").json()
        second = client.post(URL, payload(label="Work"), format="json").json()
        assert second["is_default"] is False
        assert defaults(user) == [first["id"]]

    def test_create_with_is_default_moves_the_default(self):
        user = make_user()
        client = client_for(user)
        client.post(URL, payload(), format="json")
        second = client.post(URL, payload(label="Work", is_default=True), format="json").json()
        assert second["is_default"] is True
        assert defaults(user) == [second["id"]]

    def test_list_returns_only_mine_default_first(self):
        user, other = make_user(), make_user()
        make_address(other)
        client = client_for(user)
        a = client.post(URL, payload(label="A"), format="json").json()
        b = client.post(URL, payload(label="B"), format="json").json()
        rows = client.get(URL).json()
        assert [r["id"] for r in rows][0] == a["id"] and {r["id"] for r in rows} == {a["id"], b["id"]}

    def test_retrieve_update_patch(self):
        user = make_user()
        client = client_for(user)
        created = client.post(URL, payload(), format="json").json()
        assert client.get(f"{URL}{created['id']}/").status_code == 200
        res = client.patch(f"{URL}{created['id']}/", {"city": "Dublin", "instructions": "Ring twice"}, format="json")
        assert res.status_code == 200 and res.json()["city"] == "Dublin"
        put = client.put(f"{URL}{created['id']}/", payload(label="Flat", city="Cork"), format="json")
        assert put.status_code == 200 and put.json()["label"] == "Flat"
        assert defaults(user) == [created["id"]]

    @pytest.mark.parametrize("field", ["recipient_name", "phone", "line1", "city"])
    def test_required_fields(self, field):
        data = payload()
        data.pop(field)
        res = client_for(make_user()).post(URL, data, format="json")
        assert res.status_code == 400 and field in res.json()["error"]["fields"]

    @pytest.mark.parametrize("phone", ["abc", "12", "<script>", "+1 555 010 0100 ext 9 9 9 9 9 9 9 9"])
    def test_phone_validation(self, phone):
        res = client_for(make_user()).post(URL, payload(phone=phone), format="json")
        assert res.status_code == 400 and "phone" in res.json()["error"]["fields"]

    def test_cannot_set_owner(self):
        user, other = make_user(), make_user()
        res = client_for(user).post(URL, payload(user=other.pk), format="json")
        assert res.status_code == 201
        assert Address.objects.get(pk=res.json()["id"]).user_id == user.pk


class TestZones:
    def test_active_zone_accepted_and_named(self):
        zone = make_zone("Old Town")
        res = client_for(make_user()).post(URL, payload(zone=zone.pk), format="json")
        assert res.status_code == 201 and res.json()["zone"] == zone.pk and res.json()["zone_name"] == "Old Town"

    def test_inactive_zone_rejected(self):
        zone = make_zone()
        zone.is_active = False
        zone.save()
        res = client_for(make_user()).post(URL, payload(zone=zone.pk), format="json")
        assert res.status_code == 400 and "zone" in res.json()["error"]["fields"]

    def test_unknown_zone_rejected(self):
        res = client_for(make_user()).post(URL, payload(zone=99999), format="json")
        assert res.status_code == 400

    def test_existing_zone_that_later_went_inactive_can_stay(self):
        zone = make_zone()
        user = make_user()
        client = client_for(user)
        created = client.post(URL, payload(zone=zone.pk), format="json").json()
        zone.is_active = False
        zone.save()
        keep = client.patch(f"{URL}{created['id']}/", {"city": "Elsewhere", "zone": zone.pk}, format="json")
        assert keep.status_code == 200
        other = make_zone()
        other.is_active = False
        other.save()
        assert client.patch(f"{URL}{created['id']}/", {"zone": other.pk}, format="json").status_code == 400

    def test_zone_can_be_cleared(self):
        zone = make_zone()
        client = client_for(make_user())
        created = client.post(URL, payload(zone=zone.pk), format="json").json()
        res = client.patch(f"{URL}{created['id']}/", {"zone": None}, format="json")
        assert res.status_code == 200 and res.json()["zone"] is None


class TestDefaultInvariant:
    def test_set_default_action(self):
        user = make_user()
        client = client_for(user)
        a = client.post(URL, payload(label="A"), format="json").json()
        b = client.post(URL, payload(label="B"), format="json").json()
        res = client.post(f"{URL}{b['id']}/set-default/")
        assert res.status_code == 200 and res.json()["is_default"] is True
        assert defaults(user) == [b["id"]]
        assert client.get(f"{URL}{a['id']}/").json()["is_default"] is False

    def test_patch_is_default_true_moves_default_false_is_ignored(self):
        user = make_user()
        client = client_for(user)
        a = client.post(URL, payload(label="A"), format="json").json()
        b = client.post(URL, payload(label="B"), format="json").json()
        client.patch(f"{URL}{a['id']}/", {"is_default": False}, format="json")
        assert defaults(user) == [a["id"]]
        client.patch(f"{URL}{b['id']}/", {"is_default": True}, format="json")
        assert defaults(user) == [b["id"]]

    def test_deleting_default_promotes_another(self):
        user = make_user()
        client = client_for(user)
        a = client.post(URL, payload(label="A"), format="json").json()
        b = client.post(URL, payload(label="B"), format="json").json()
        assert client.delete(f"{URL}{a['id']}/").status_code == 204
        assert defaults(user) == [b["id"]]

    def test_deleting_non_default_keeps_default(self):
        user = make_user()
        client = client_for(user)
        a = client.post(URL, payload(label="A"), format="json").json()
        b = client.post(URL, payload(label="B"), format="json").json()
        client.delete(f"{URL}{b['id']}/")
        assert defaults(user) == [a["id"]]

    def test_deleting_last_address_leaves_no_default(self):
        user = make_user()
        client = client_for(user)
        a = client.post(URL, payload(), format="json").json()
        client.delete(f"{URL}{a['id']}/")
        assert defaults(user) == []
        again = client.post(URL, payload(), format="json").json()
        assert again["is_default"] is True

    def test_soft_delete_keeps_row_for_order_snapshots(self):
        user = make_user()
        client = client_for(user)
        a = client.post(URL, payload(), format="json").json()
        client.delete(f"{URL}{a['id']}/")
        row = Address.objects.get(pk=a["id"])
        assert row.is_deleted is True and row.is_default is False
        assert client.get(URL).json() == []
        assert client.get(f"{URL}{a['id']}/").status_code == 404
        assert client.patch(f"{URL}{a['id']}/", {"city": "x"}, format="json").status_code == 404

    def test_limit_of_ten_active_addresses(self):
        user = make_user()
        client = client_for(user)
        ids = [
            client.post(URL, payload(label=f"A{i}"), format="json").json()["id"] for i in range(MAX_ACTIVE_ADDRESSES)
        ]
        res = client.post(URL, payload(label="one too many"), format="json")
        assert res.status_code == 409 and res.json()["error"]["code"] == "address_limit_reached"
        client.delete(f"{URL}{ids[-1]}/")  # deleted addresses do not count
        assert client.post(URL, payload(label="fits now"), format="json").status_code == 201
        assert len(defaults(user)) == 1


class TestOwnership:
    def test_foreign_address_is_404_for_every_verb(self):
        owner, intruder = make_user(), make_user()
        theirs = make_address(owner, is_default=True)
        client = client_for(intruder)
        url = f"{URL}{theirs.pk}/"
        assert client.get(url).status_code == 404
        assert client.patch(url, {"city": "Hacked"}, format="json").status_code == 404
        assert client.put(url, payload(), format="json").status_code == 404
        assert client.delete(url).status_code == 404
        assert client.post(f"{url}set-default/").status_code == 404
        theirs.refresh_from_db()
        assert theirs.city != "Hacked" and not theirs.is_deleted
        assert client.get(URL).json() == []
