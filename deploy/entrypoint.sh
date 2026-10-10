#!/bin/sh
# Waits for PostgreSQL (container start != ready), optionally migrates / collects static, then execs the command.
set -e
python - <<'PY'
import os, sys, time
import psycopg
from urllib.parse import urlparse

url = os.environ.get("DATABASE_URL")
if not url:
    sys.exit(0)
deadline = time.time() + 60
while True:
    try:
        psycopg.connect(url, connect_timeout=3).close()
        break
    except Exception as exc:  # noqa: BLE001
        if time.time() > deadline:
            sys.exit(f"database not ready: {exc}")
        time.sleep(1)
PY
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  python manage.py migrate --noinput
  # Seeding only ever happens in the service that migrates (not the workers).
  if [ "${SEED_DEMO:-0}" = "1" ]; then python manage.py seed_demo --allow-production; fi
fi
if [ "${RUN_COLLECTSTATIC:-0}" = "1" ]; then python manage.py collectstatic --noinput; fi
exec "$@"
