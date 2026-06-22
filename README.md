# MyPong

A real-time multiplayer Pong game: 1v1 online, matchmaking, tournaments, and AI opponent. Built as a full-stack portfolio project using a microservices architecture.

> **Active development** — see [Phase plan](#phase-plan) below for current status.

---

## What is implemented today

**Phase 1 / PR 1 — auth-service** (complete)

- `POST /register` — create account with email + password (argon2 hash)
- `POST /login` — returns access token (15 min) + refresh token (7 days)
- `POST /refresh` — rotates refresh token, returns new pair
- `DELETE /session` — revokes refresh token (logout)

Everything else (gateway-api, WebSocket hub, game engine, matchmaking, tournaments, AI, frontend) is under construction.

---

## Prerequisites

- Docker and Docker Compose
- Make
- Node.js 22 (only needed for the native dev setup below)

---

## How to run

There are **two independent ways** to run auth-service locally. They use separate Postgres instances and both bind to port 4001 — don't run them at the same time.

### Option A — Full Docker Compose stack

This runs auth-service as a container, the same way it would run in production.

```bash
cp .env.example .env   # fill in JWT_SECRET, JWT_REFRESH_SECRET, and DB credentials
make up                # starts postgres + auth-service
```

The database starts empty — migrations need to be run once against this container:

```bash
docker compose -p mypong exec auth-service npx node-pg-migrate up
```

Auth-service will be available at `http://localhost:4001` once healthy. Stop everything with `make down` before switching to Option B.

### Option B — Native dev (faster iteration, no image rebuilds)

auth-service runs directly with Node; only Postgres runs in Docker, in its own standalone container, separate from the one Option A uses.

```bash
# Skip this if mypong-pg-dev already exists — check with: docker ps -a
docker run --name mypong-pg-dev \
  -e POSTGRES_DB=mypong -e POSTGRES_USER=mypong_user -e POSTGRES_PASSWORD=dev_password \
  -p 5433:5432 -d postgres:16-alpine

cd services/auth-service
set -a && source .env && set +a
npm run migrate:up
npm run dev            # http://localhost:4001
```

### Running the smoke tests

Works against either option above, once auth-service is up:

```bash
cd services/auth-service
./scripts/smoke-test.sh
```

---

## Phase plan

| Phase 0 | Repo structure, tsconfig, Docker Compose skeleton, Makefile, CI (Done)
| Phase 1 | auth-service + gateway-api + frontend login/register (In progress)
| Phase 2 | user-service + frontend profile + avatar upload (Pending)
| Phase 3 | gateway-ws + game-service + Pong board with local 1v1 (Pending)
| Phase 4 | matchmaking-service + frontend lobby (Pending)
| Phase 5 | ia-bot-service + guest mode (Pending)
| Phase 6 | tournament-service + frontend brackets (Pending)
| Phase 7 | Unit test coverage review across all services (Pending)
| Phase 8 | Full CI and basic CD + final README (Pending)

---

## Stack

| Layer     |                      Technology                          
|-----------|-------------------------------------------------------------
| Frontend  | React 18 + TypeScript + Vite + Zustand + React Router
| Backend   | Node.js 22 + Fastify + TypeScript (strict, compiled) 
| Auth      | JWT (access 15 min + refresh 7 days) + argon2        
| Database  | PostgreSQL 16 + node-pg-migrate
| Proxy     | nginx (TLS + reverse proxy + static files + avatar serving)
| Runtime   | Docker Compose + multi-stage builds
| Tests     | Vitest + React Testing Library
| CI        | GitHub Actions