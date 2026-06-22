COMPOSE  = docker compose
PROJECT  = mypong

# Services listed here must have a real Dockerfile. Add each service as it is
# implemented: gateway-api (PR2), user-service (Fase2), etc.
# Phase 1 (current): postgres (official image) + auth-service.
up:
	@$(COMPOSE) -p $(PROJECT) up --build -d postgres auth-service

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