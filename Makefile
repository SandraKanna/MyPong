COMPOSE  = docker compose
PROJECT  = mypong

# Services listed here must have a real Dockerfile. Add each service as it is implemented and merged to main.
# Phase 1 (current): postgres (official image) + auth-service + gateway-api.
up:
	@$(COMPOSE) -p $(PROJECT) up --build -d postgres auth-service gateway-api

down:
	@$(COMPOSE) -p $(PROJECT) down

logs:
	@$(COMPOSE) -p $(PROJECT) logs -f

ps:
	@$(COMPOSE) -p $(PROJECT) ps

clean:
	@$(COMPOSE) -p $(PROJECT) down --rmi local
# 	rmi local to clean only local images (not the ones downloaded from Docker hub for example)

fclean:
	@$(COMPOSE) -p $(PROJECT) down --rmi local -v
# 	"-v" to clean named volumes as well

rebuild: fclean up

.PHONY: up down logs ps clean fclean rebuild