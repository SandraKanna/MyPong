COMPOSE  = docker compose
PROJECT  = mypong

up:
	@$(COMPOSE) -p $(PROJECT) up --build -d
# 	in dev mode "--build" to force rebuilding images so code modifications are always taken into account

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