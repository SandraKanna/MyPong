# MyPong

A real-time multiplayer Pong game: 1v1 online, matchmaking, and an AI opponent. Built as a full-stack portfolio project using a microservices architecture.

<img src="../../docs/img/mypong-home.png" alt="PvE match with the AI-controlled paddle in play" width="500">

MyPong reimplements the scope of Transcendence, a 42 School capstone project, from scratch — same core requirements (real-time gameplay, JWT auth, microservices), rebuilt with modern tooling and stronger engineering practices (TypeScript throughout, React, test automation and CI, consistent test coverage) than the original assignment required.


> **Active development** — see [Phase plan](#phase-plan) below for current status.

---

## What is implemented today

- **auth-service** — register, login, refresh (with rotation), logout (with revocation)
- **user-service** — profile (display name), avatar upload, match stats and history
- **gateway-api** — REST proxy with JWT validation for protected routes
- **gateway-ws** — WebSocket hub: browser auth, message routing by type prefix, user-targeted delivery
- **game-service** — real-time physics (ball, paddles, score), session lifecycle, pause/reconnect grace window
- **match-service** — FIFO matchmaking queue, match creation and closure, history event emission
- **ai-bot-service** — AI opponent for PvE matches, guest and logged-in play, difficulty presets
- **Public Edge (nginx)** — TLS termination, reverse proxy, static frontend serving, avatar serving
- **frontend** — login/register, protected routing, profile + avatar, 1v1 game (lobby, countdown, live board, pause overlay, result screen)

See [Running a service locally](#running-a-service-locally) below for endpoint-level detail on each piece.

AI opponent and guest mode are fully implemented. Tournament mode — part of Transcendence's original requirements — was evaluated and intentionally left out of this rebuild's scope; see the note under [Phase plan](#phase-plan).

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
`DATABASE_URL` to use that same password.

nginx also requires a TLS certificate to start. Generate a self-signed one for local dev, from the repo root:

```bash
./scripts/generate-dev-cert.sh
```

This is a one-time step (no-op if the certs already exist, `--force` to regenerate) — see [nginx's README](nginx/README.md#tls-certificates-local-dev) for what it generates (2048-bit RSA, `CN=localhost`, 365-day validity) and why it's needed. Without it, the `nginx` container fails to start: `nginx.conf` requires `nginx/certs/cert.pem` and `key.pem` to exist.

`make up` then starts the implemented stack — also applying all pending migrations automatically (`auth-service`, then `user-service`, then `match-service`, in that order since `user-service`'s tables have a foreign key into `auth-service`'s `users` table).

---

## Running a service locally

Each service has its own README with the full setup (Docker + native) and smoke test:

- [`services/auth-service/README.md`](services/auth-service/README.md)
- [`services/gateway-api/README.md`](services/gateway-api/README.md)
- [`services/gateway-ws/README.md`](services/gateway-ws/README.md)
- [`services/user-service/README.md`](services/user-service/README.md)
- [`services/game-service/README.md`](services/game-service/README.md)
- [`services/match-service/README.md`](services/match-service/README.md)
- [`services/ai-bot-service/README.md`](services/ai-bot-service/README.md)
- [`nginx/README.md`](nginx/README.md)
- [`frontend/README.md`](frontend/README.md)

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
| Phase 5 | ai-bot-service + guest mode (Done)
| Phase 6 | Onboarding polish, batch profile lookup, profile stats frontend, in-match username display, single-session-per-user enforcement (Done).
| Phase 7 | Unit test coverage review across all services (Done)
| Phase 8 | Full CI coverage across all services + final README (Done)

tournament-service was designed (DB schema + WebSocket contracts) but intentionally left out of this portfolio's scope — the architectural pattern it would demonstrate (a WebSocket-client service with its own database, connected to the gateway) is already fully demonstrated by match-service.

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