import logging

import pytest
from django.core import mail
from django.db import transaction

from apps.notifications import services
from apps.notifications.models import Notification
from apps.notifications.tasks import send_notification_email
from apps.orders.models import Order
from apps.payments.tests.helpers import make_order, settle
from tests.factories import make_user

RECORDING = "apps.notifications.tests.backends.RecordingBackend"
FAILING = "apps.notifications.tests.backends.FailingBackend"
FLAKY = "apps.notifications.tests.backends.FlakyBackend"


@pytest.fixture
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


@pytest.mark.django_db
class TestInAppNotification:
    def test_created_for_the_customer_with_tailored_copy(self, notify):
        pickup = make_order(order_type="PICKUP")
        delivery = make_order(order_type="DELIVERY")
        a, b = notify(pickup, "order_confirmed"), notify(delivery, "order_confirmed")
        assert a.user == pickup.customer and a.order == pickup and a.kind == "order_confirmed"
        assert a.title == f"Order {pickup.number} confirmed" and not a.is_read
        assert "delivery" not in a.body.lower() and "for delivery" in b.body
        assert (
            "picked up" in notify(pickup, "order_completed").title
            and "delivered" in notify(delivery, "order_completed").title
        )
        assert "pickup" in notify(pickup, "order_ready").title.lower()
        assert "on its way" in notify(delivery, "order_out_for_delivery").title.lower()

    @pytest.mark.parametrize("kind", services.KINDS)
    def test_every_kind_has_valid_lengths(self, kind, notify):
        order = make_order(order_type="DELIVERY")
        n = notify(order, kind)
        assert 0 < len(n.title) <= 120 and 0 < len(n.body) <= 300

    def test_placed_copy_depends_on_payment_method(self, notify):
        online = notify(make_order(payment_method="stripe"), "order_placed")
        cash = notify(make_order(payment_method="cash"), "order_placed")
        assert "payment" in online.body and "when you collect" in cash.body

    def test_unknown_kind_never_raises(self):
        order = make_order()
        services.notify_order_event(order, "nonsense")
        assert not Notification.objects.exists()

    def test_database_failure_is_swallowed_and_does_not_poison_the_transaction(self, monkeypatch):
        order = make_order()

        def boom(*a, **k):
            raise RuntimeError("db down")

        monkeypatch.setattr(Notification.objects, "create", boom)
        with transaction.atomic():
            services.notify_order_event(order, "order_confirmed")
            assert Order.objects.filter(pk=order.pk).exists()  # transaction still usable

    def test_rolled_back_business_change_leaves_no_notification_or_email(self, real_backend):
        order = make_order()
        with pytest.raises(RuntimeError), transaction.atomic():
            services.notify_order_event(order, "order_confirmed")
            raise RuntimeError("business failure")
        assert not Notification.objects.exists() and mail.outbox == []


@pytest.mark.django_db
class TestEmailDelivery:
    def test_email_goes_to_the_customer_with_branded_content(self, real_backend, notify, settings):
        settings.SITE_URL = "https://shop.test"
        order = make_order(
            customer=make_user("alex@example.com"),
            items=[("Flat white", "4.50", 2, [("Milk", "Oat", "0.50")]), ("Beans 250g", "14.00", 1)],
            payment_method="cash",
            customer_email="alex@example.com",
            tax="1.00",
        )
        n = notify(order, "order_confirmed")
        (msg,) = mail.outbox
        assert msg.to == ["alex@example.com"] and msg.subject == f"Order {order.number} confirmed"
        html = msg.alternatives[0][0]
        for body in (msg.body, html):
            assert order.number in body and "$25.00" in body and "Flat white" in body and "Oat" in body
            assert f"https://shop.test/orders/{order.number}" in body
        assert "#2B1D16" in html and "#B4602B" in html  # espresso + copper
        n.refresh_from_db()
        assert n.email_status == "sent"

    def test_delivery_and_pickup_details(self, real_backend, notify):
        d = make_order(order_type="DELIVERY")
        notify(d, "order_out_for_delivery")
        p = make_order(order_type="PICKUP")
        notify(p, "order_ready")
        delivery_msg, pickup_msg = mail.outbox
        assert "Delivery to" in delivery_msg.body and "5 Road" in delivery_msg.body and "Delivery:" in delivery_msg.body
        assert "Pickup at" in pickup_msg.body and p.branch.name in pickup_msg.body
        assert pickup_msg.subject == f"Order {p.number} is ready for pickup"

    def test_refund_email_shows_amount(self, real_backend, notify):
        order = make_order(items=[("Beans", "10.00", 1)])
        order.refunded_total = 4
        order.save()
        notify(order, "refund_updated")
        assert "Refunded: $4.00" in mail.outbox[0].body

    def test_transactional_email_ignores_marketing_opt_out(self, real_backend, notify):
        order = make_order()
        assert order.customer.marketing_opt_in is False
        notify(order, "order_placed")
        assert len(mail.outbox) == 1

    def test_in_app_only_kinds_skip_email(self, real_backend, notify):
        n = notify(make_order(), "order_preparing")
        assert n.email_status == "skipped" and mail.outbox == []

    def test_user_content_is_escaped_in_html(self, real_backend, notify):
        order = make_order(items=[("<script>alert(1)</script>", "3.00", 1)])
        notify(order, "order_placed")
        html = mail.outbox[0].alternatives[0][0]
        assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html

    def test_console_backend_is_reported_honestly(self, settings, notify, caplog):
        settings.EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
        caplog.set_level(logging.INFO)
        n = notify(make_order(), "order_placed")
        assert n.email_status == "console" and "console (not delivered)" in caplog.text

    def test_redelivered_task_sends_once(self, real_backend, notify):
        n = notify(make_order(), "order_placed")
        send_notification_email.apply(args=[n.pk])
        send_notification_email.apply(args=[n.pk])
        assert len(mail.outbox) == 1

    def test_deleted_notification_is_skipped(self, real_backend):
        send_notification_email.apply(args=[999999])
        assert mail.outbox == []


@pytest.mark.django_db
class TestEmailFailure:
    def test_failure_marks_failed_and_never_touches_order_or_payment(self, settings, notify, caplog):
        settings.EMAIL_BACKEND = FAILING
        order = make_order(status="CONFIRMED", payment_method="stripe")
        payment = settle(order, "stripe")
        n = notify(order, "payment_confirmed")
        order.refresh_from_db()
        payment.refresh_from_db()
        n.refresh_from_db()
        assert n.email_status == "failed"
        assert (order.status, order.payment_status, payment.status) == ("CONFIRMED", "PAID", "PAID")

    def test_transient_failure_retries_then_succeeds(self, settings, notify):
        from apps.notifications.tests.backends import FlakyBackend

        settings.EMAIL_BACKEND = FLAKY
        FlakyBackend.failures_left = 2
        mail.outbox.clear()
        n = notify(make_order(), "order_placed")
        assert n.email_status == "sent" and len(mail.outbox) == 1

    def test_broker_outage_marks_failed_without_raising(
        self, real_backend, monkeypatch, django_capture_on_commit_callbacks
    ):
        def down(*a, **k):
            raise ConnectionError("redis unavailable")

        monkeypatch.setattr(send_notification_email, "delay", down)
        order = make_order()
        with django_capture_on_commit_callbacks(execute=True):
            services.notify_order_event(order, "order_placed")
        n = Notification.objects.get(order=order)
        assert n.email_status == "failed"

    def test_payment_pipeline_survives_email_failure(self, settings, django_capture_on_commit_callbacks):
        from apps.payments import services as pay
        from apps.payments.tests.helpers import demo_event

        settings.EMAIL_BACKEND = FAILING
        order = make_order()
        attempt = pay.start_payment(order, "demo", return_url="https://a.test/", cancel_url="https://a.test/").payment
        with django_capture_on_commit_callbacks(execute=True):
            stored = pay.handle_provider_event("demo", demo_event(attempt, "success"))
        order.refresh_from_db()
        assert stored.outcome == "applied" and order.payment_status == "PAID"
        assert Notification.objects.get(order=order, kind="payment_confirmed").email_status == "failed"
