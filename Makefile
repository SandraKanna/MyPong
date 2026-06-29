COMPOSE  = docker compose
PROJECT  = mypong

# Services listed here must have a real Dockerfile. Add each service as it is implemented and merged to main.
# Phase 1 + Public Edge: postgres (official image) + auth-service + gateway-api + nginx.

SERVICES = postgres auth-service user-service gateway-api gateway-ws game-service nginx

# Build (if needed) and create + start the stack. Use after code changes.
up:
	@$(COMPOSE) -p $(PROJECT) up --build -d $(SERVICES)

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

.PHONY: up start stop down logs ps clean fclean rebuild