from django.urls import include, path
from rest_framework.routers import SimpleRouter

from . import views

router = SimpleRouter()
router.register("addresses", views.AddressViewSet, basename="address")

urlpatterns = [
    path("auth/csrf/", views.CsrfView.as_view(), name="auth-csrf"),
    path("auth/register/", views.RegisterView.as_view(), name="auth-register"),
    path("auth/login/", views.LoginView.as_view(), name="auth-login"),
    path("auth/logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("auth/me/", views.MeView.as_view(), name="auth-me"),
    path("auth/password-reset/", views.PasswordResetRequestView.as_view(), name="auth-password-reset"),
    path("auth/password-reset/confirm/", views.PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
    path("auth/verify-email/", views.VerifyEmailView.as_view(), name="auth-verify-email"),
    path("auth/resend-verification/", views.ResendVerificationView.as_view(), name="auth-resend-verification"),
    path("account/", views.AccountView.as_view(), name="account"),
    path("account/password/", views.PasswordChangeView.as_view(), name="account-password"),
    path("", include(router.urls)),
]
