"""Email backends for tests. Names deliberately avoid 'console'/'locmem' so they count as real delivery."""

import smtplib

from django.core.mail.backends.locmem import EmailBackend as LocmemBackend


class RecordingBackend(LocmemBackend):
    """Behaves like a real transport: messages land in `django.core.mail.outbox`."""


class FailingBackend(RecordingBackend):
    def send_messages(self, email_messages):
        raise smtplib.SMTPServerDisconnected("connection refused (test)")


class FlakyBackend(RecordingBackend):
    """Fails the first N sends, then works."""

    failures_left = 2

    def send_messages(self, email_messages):
        if FlakyBackend.failures_left > 0:
            FlakyBackend.failures_left -= 1
            raise smtplib.SMTPServerDisconnected("temporary failure (test)")
        return super().send_messages(email_messages)
