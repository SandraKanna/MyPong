COMPOSE  = docker compose
PROJECT  = mypong

# Services listed here must have a real Dockerfile. Add each service as it is implemented and merged to main.
# Phase 1 + Public Edge: postgres (official image) + auth-service + gateway-api + nginx.

SERVICES = postgres auth-service user-service gateway-api gateway-ws game-service match-service ai-bot-service nginx

# Build (if needed) and create + start the stack. Use after code changes.
up:
	@$(COMPOSE) -p $(PROJECT) up --build -d $(SERVICES)
	@$(MAKE) migrate

# Apply pending migrations for each service that owns tables. Order matters:
# auth-service must run before user-service (FK dependency on users). Safe to
# re-run on an already-migrated database — node-pg-migrate skips applied ones.
migrate:
	@$(COMPOSE) -p $(PROJECT) exec -T auth-service npx node-pg-migrate up --migrations-table pgmigrations_auth
	@$(COMPOSE) -p $(PROJECT) exec -T user-service npx node-pg-migrate up --migrations-table pgmigrations_user
	@$(COMPOSE) -p $(PROJECT) exec -T match-service npx node-pg-migrate up --migrations-table pgmigrations_match

# Stop running containers WITHOUT removing them (fast; preserves state and data).
stop:
	@$(COMPOSE) -p $(PROJECT) stop

# Start previously-stopped containers WITHOUT rebuilding (fast).
start:
	@$(COMPOSE) -p $(PROJECT) start

# Stop and REMOVE containers (keeps images and volumes).
down:
	@$(COMPOSE) -p $(PROJECT) down

logs:
	@$(COMPOSE) -p $(PROJECT) logs -f

ps:
	@$(COMPOSE) -p $(PROJECT) ps

# 	rmi local to clean only locally-built images (not pulled ones like postgres).
clean:
	@$(COMPOSE) -p $(PROJECT) down --rmi local

# 	"-v" to clean named volumes as well
fclean:
	@$(COMPOSE) -p $(PROJECT) down --rmi local -v

rebuild: fclean up

.PHONY: up migrate start stop down logs ps clean fclean rebuild