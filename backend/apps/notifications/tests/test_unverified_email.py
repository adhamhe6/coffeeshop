"""Finding S9: order / payment / refund email only goes to verified addresses; in-app notifications always exist."""

import pytest
from django.core import mail

from apps.accounts import services as account_services
from apps.cart.tests.fixtures import add_to_cart, client_for, do_checkout
from apps.notifications import services
from apps.notifications.models import Notification
from apps.notifications.tasks import send_notification_email
from apps.orders.models import Order
from apps.orders.services import cancel_order, transition_order
from apps.payments.tests.helpers import make_order
from tests.factories import make_staff, make_user

RECORDING = "apps.notifications.tests.backends.RecordingBackend"
pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def real_backend(settings):
    settings.EMAIL_BACKEND = RECORDING
    mail.outbox.clear()


@pytest.fixture
def notify(django_capture_on_commit_callbacks):
    def _notify(order, kind):
        with django_capture_on_commit_callbacks(execute=True):
            services.notify_order_event(order, kind)
        return Notification.objects.filter(order=order, kind=kind).latest("id")

    return _notify


@pytest.mark.parametrize("kind", [k for k in services.KINDS if k not in services.NO_EMAIL_KINDS])
def test_unverified_customer_gets_the_in_app_notification_but_no_email(notify, kind):
    order = make_order(customer=make_user(unverified=True), payment_method="cash")
    n = notify(order, kind)
    assert n.title and n.user_id == order.customer_id
    assert n.email_status == "skipped_unverified"
    assert mail.outbox == []


@pytest.mark.parametrize("kind", [k for k in services.KINDS if k not in services.NO_EMAIL_KINDS])
def test_verified_customer_gets_both(notify, kind):
    order = make_order(customer=make_user(), payment_method="cash")
    n = notify(order, kind)
    assert n.email_status == "sent" and len(mail.outbox) == 1
    assert mail.outbox[0].to == [order.customer.email]


def test_in_app_only_kinds_stay_skipped_not_unverified(notify):
    order = make_order(customer=make_user(unverified=True))
    assert notify(order, "order_preparing").email_status == "skipped"


def test_verifying_later_turns_emails_on_for_future_events_only(notify):
    user = make_user(unverified=True)
    order = make_order(customer=user)
    first = notify(order, "order_placed")
    account_services.mark_email_verified(user)
    order.refresh_from_db()
    second = notify(order, "order_confirmed")
    assert first.email_status == "skipped_unverified" and second.email_status == "sent"
    assert len(mail.outbox) == 1 and mail.outbox[0].subject.endswith("confirmed")


def test_email_goes_to_the_current_verified_address_not_the_checkout_snapshot(notify):
    user = make_user("old@example.com")
    order = make_order(customer=user, customer_email="old@example.com")
    type(user).objects.filter(pk=user.pk).update(email="new@example.com")
    order.refresh_from_db()
    notify(order, "order_confirmed")
    assert mail.outbox[0].to == ["new@example.com"]


def test_queued_email_is_dropped_if_the_address_became_unverified_before_sending(django_capture_on_commit_callbacks):
    user = make_user()
    order = make_order(customer=user)
    n = Notification.objects.create(
        user=user, order=order, kind="order_confirmed", title="t", body="b", email_status="queued"
    )
    type(user).objects.filter(pk=user.pk).update(email_verified_at=None, email="changed@example.com")
    send_notification_email.apply(args=[n.pk])
    n.refresh_from_db()
    assert mail.outbox == [] and n.email_status == "skipped_unverified"


def test_inactive_users_get_no_order_email(notify):
    order = make_order(customer=make_user(is_active=False))
    assert notify(order, "order_confirmed").email_status == "skipped_unverified"
    assert mail.outbox == []


def test_password_reset_still_mails_an_unverified_address():
    user = make_user("reset@example.com", unverified=True)
    client_for().post("/api/v1/auth/password-reset/", {"email": user.email}, format="json")
    assert [m.to for m in mail.outbox] == [["reset@example.com"]]


class TestCheckoutWithoutVerification:
    """Purchases are never blocked; only the mail is withheld."""

    def test_unverified_customer_can_order_and_follow_it_in_app(
        self, shop, settings, django_capture_on_commit_callbacks
    ):
        user = make_user(unverified=True)
        client = client_for(user)
        add_to_cart(client, shop.pastry)
        with django_capture_on_commit_callbacks(execute=True):
            res = do_checkout(client, shop, payment_method="cash")
        assert res.status_code == 201
        order = Order.objects.get(number=res.data["order"]["number"])
        assert mail.outbox == []
        placed = Notification.objects.get(order=order, kind="order_placed")
        assert placed.email_status == "skipped_unverified"
        assert client.get("/api/v1/notifications/").status_code == 200

        with django_capture_on_commit_callbacks(execute=True):
            transition_order(order, "CONFIRMED", actor=make_staff("ADMIN"))
            cancel_order(order, actor="system", reason="x")
        kinds = set(Notification.objects.filter(order=order).values_list("kind", "email_status"))
        assert ("order_confirmed", "skipped_unverified") in kinds
        assert ("order_cancelled", "skipped_unverified") in kinds
        assert mail.outbox == []

    def test_same_flow_for_a_verified_customer_sends_mail(self, shop, django_capture_on_commit_callbacks):
        user = make_user()
        client = client_for(user)
        add_to_cart(client, shop.pastry)
        with django_capture_on_commit_callbacks(execute=True):
            res = do_checkout(client, shop, payment_method="cash")
        assert res.status_code == 201
        assert [m.to for m in mail.outbox] == [[user.email]]
