#!/bin/sh
# Creates .env from .env.example with freshly generated secrets (never overwrites an existing .env).
set -e
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env already exists — leaving it untouched."; exit 0; fi
secret() { python3 -c "import secrets; print(secrets.token_urlsafe(64))"; }
sed -e "s|^DJANGO_SECRET_KEY=.*|DJANGO_SECRET_KEY=$(secret)|" \
    -e "s|^PAYMENT_DEMO_WEBHOOK_SECRET=.*|PAYMENT_DEMO_WEBHOOK_SECRET=$(secret)|" \
    .env.example > .env
chmod 600 .env
echo "Created .env with generated DJANGO_SECRET_KEY and PAYMENT_DEMO_WEBHOOK_SECRET."
echo "Review it (Stripe keys, email, domain) before any real deployment."
