# MyPong

A real-time multiplayer Pong game: 1v1 online, matchmaking, tournaments, and AI opponent. Built as a full-stack portfolio project using a microservices architecture.

> **Active development** — see [Phase plan](#phase-plan) below for current status.

---

## What is implemented today

- **auth-service** — register, login, refresh (with rotation), logout (with revocation)
- **user-service** — profile (display name), avatar upload, match stats and history
- **gateway-api** — REST proxy with JWT validation for protected routes
- **gateway-ws** — WebSocket hub: browser auth, message routing by type prefix, user-targeted delivery
- **game-service** — real-time physics (ball, paddles, score), session lifecycle, pause/reconnect grace window
- **match-service** — FIFO matchmaking queue, match creation and closure, history event emission
- **Public Edge (nginx)** — TLS termination, reverse proxy, static frontend serving
- **frontend** — login/register, protected routing, profile + avatar, 1v1 game (lobby, countdown, live board, pause overlay, result screen)

See each service's README for endpoint-level detail and setup.

Tournaments and AI opponent are under construction.

---

## Prerequisites

- Docker and Docker Compose
- Make
- Node.js 24 (only needed for the native dev setup in each service's README)

Before running `make up` for the first time, create the root `.env`:

```bash
cp .env.example .env
```

Fill in `JWT_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_SERVICE_SECRET` and `POSTGRES_PASSWORD` — then update
`DATABASE_URL` to use that same password (it appears twice in the file; the
comment in `.env.example` explains why).

`make up` then starts the implemented stack. See each service's README for endpoint-level testing.

---

## Running a service locally

Each service has its own README with the full setup (Docker + native) and smoke test:

- [`services/auth-service/README.md`](services/auth-service/README.md)
- [`services/gateway-api/README.md`](services/gateway-api/README.md)
- [`services/gateway-ws/README.md`](services/gateway-ws/README.md)
- [`services/user-service/README.md`](services/user-service/README.md)
- [`services/game-service/README.md`](services/game-service/README.md)
- `services/match-service/` — README pending

---

## CI

Backend services run through 4 jobs in sequence: **lint → typecheck → test → docker-build**, using a matrix over all implemented services. Services within a stage run in parallel.
Adding a new backend service in a future phase = one string added to the matrix.

The frontend (including Public Edge/nginx) runs as a separate job: **lint → typecheck → test → build**, with nginx's Docker build as its final step.

`main` is protected by a GitHub Ruleset: PRs are required, and all required checks (backend matrix + Frontend job) must be green before merge.

---

## Phase plan

| Phase 0 | Repo structure, tsconfig, Docker Compose skeleton, Makefile, CI (Done)
| Phase 1 | auth-service + gateway-api + frontend login/register + Public Edge (Done)
| Phase 2 | user-service + frontend profile + avatar upload (Done)
| Phase 3 | gateway-ws hub + game-service (physics, session lifecycle, pause/reconnect) + match-service (matchmaking, match lifecycle, stats/history recording) (Done)
| Phase 4 | Full game frontend: lobby, 3s countdown, live board, pause overlay, result screen (Done)
| Phase 5 | ia-bot-service + guest mode (Pending)
| Phase 6 | tournament-service + frontend brackets (Pending)
| Phase 7 | Unit test coverage review across all services (Pending)
| Phase 8 | Full CI and basic CD + final README (Pending)

---

## Stack

| Layer     |                      Technology                          
|-----------|-------------------------------------------------------------
| Frontend  | React 19 + TypeScript 6 + Vite 8 + Zustand + React Router
| Backend   | Node.js 24 + Fastify + TypeScript (strict, compiled) 
| Auth      | JWT (access 15 min + refresh 7 days) + argon2        
| Database  | PostgreSQL 16 + node-pg-migrate
| Proxy     | nginx (TLS + reverse proxy + static files + avatar serving)
| Runtime   | Docker Compose + multi-stage builds
| Tests     | Vitest + React Testing Library
| CI        | GitHub Actions