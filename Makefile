.PHONY: env up seed test lint e2e api-smoke

env:            ## create .env with generated secrets
	./deploy/init-env.sh
up: env         ## build and start the whole stack (http://localhost:8080)
	docker compose up --build
seed:           ## load demo data into the running stack (development only)
	docker compose exec backend python manage.py seed_demo --allow-production
test:           ## backend + frontend unit tests
	cd backend && ../.venv/bin/pytest -n 4 -q
	cd frontend && npm test
lint:
	cd backend && ../.venv/bin/ruff check . && ../.venv/bin/ruff format --check .
	cd frontend && npm run lint && npm run typecheck && npm run format:check
api-smoke:      ## purchase-to-fulfilment flow against a running seeded backend
	cd backend && ../.venv/bin/python scripts/api_smoke.py
e2e:            ## browser tests (needs backend on :8000 and Chromium)
	cd frontend && npm run test:e2e
