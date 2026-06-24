# MyPong

A real-time multiplayer Pong game: 1v1 online, matchmaking, tournaments, and AI opponent. Built as a full-stack portfolio project using a microservices architecture.

> **Active development** — see [Phase plan](#phase-plan) below for current status.

---

## What is implemented today

**Phase 1 / PR 1 — auth-service** (complete)  
**Phase 1 / PR 2 — gateway-api** (complete)

- `POST /api/auth/register` — create account with email + password (argon2 hash)
- `POST /api/auth/login` — returns access token (15 min) + refresh token (7 days)
- `POST /api/auth/refresh` — rotates refresh token, returns new pair
- `DELETE /api/auth/session` — revokes refresh token (logout)
- All `/api/auth/*` routes are proxied through gateway-api, which validates JWT
  access tokens for protected routes

Everything else (WebSocket hub, game engine, matchmaking, tournaments, AI, frontend) is under construction.

---

## Prerequisites

- Docker and Docker Compose
- Make
- Node.js 22 (only needed for the native dev setup in each service's README)

Before running `make up` for the first time, create the root `.env`:

```bash
cp .env.example .env
```

Fill in `JWT_SECRET`, `JWT_REFRESH_SECRET`, and `POSTGRES_PASSWORD` — then update
`DATABASE_URL` to use that same password (it appears twice in the file; the
comment in `.env.example` explains why).

`make up` then starts the full implemented stack: `postgres`, `auth-service`, and
`gateway-api`. See each service's README for endpoint-level testing.

---

## Running a service locally

Each service has its own README with the full setup (Docker + native) and smoke test:

- [`services/auth-service/README.md`](services/auth-service/README.md)
- [`services/gateway-api/README.md`](services/gateway-api/README.md)

---

## CI

4 jobs run in sequence: **lint → typecheck → test → docker-build**.  
Each job uses a matrix over all implemented services, so services within a stage
run in parallel. Adding a new service in a future phase = one string added to
the matrix.

`main` is protected by a GitHub Ruleset: PRs are required, and all 4 CI checks
must be green before merge.

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