# syntax=docker/dockerfile:1.7
# Build context: repository root.
FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends libjpeg62-turbo libwebp7 && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 app
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
# The Django SEO shell injects per-page metadata into the built SPA index.html.
COPY --from=frontend-build /app/frontend/dist /srv/frontend
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /app/media /app/backend/staticfiles && chown -R app:app /app /srv/frontend
USER app
ENV DJANGO_SETTINGS_MODULE=config.settings.prod FRONTEND_INDEX_HTML=/srv/frontend/index.html MEDIA_ROOT=/app/media
EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "30", "--access-logfile", "-"]
