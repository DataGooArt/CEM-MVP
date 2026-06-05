.PHONY: up down logs migrate seed ps

up:
	docker compose up --build -d

down:
	docker compose down -v

logs:
	docker compose logs -f api worker web

migrate:
	docker compose exec api npx prisma migrate dev --name init

seed:
	curl -X POST http://localhost:3001/api/v1/findings/ingest -H "Content-Type: application/json" -H "x-collector-id: demo-collector" -d '{"assetId":"example.com","category":"VULNERABILITY","severity":"HIGH","title":"Exposed Admin Panel","sourceTool":"nuclei"}'

ps:
	docker compose ps
