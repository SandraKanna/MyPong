# gateway-api

REST gateway: validates JWT access tokens and proxies authenticated requests to upstream services. The only entry point for the frontend — no business logic, no database.

## Endpoints

All routes are under `/api/`. Public routes pass through without JWT validation; protected routes require a valid `Authorization: Bearer <access_token>` header.

| Method   | Path                     | Target       | Auth required |
|----------|--------------------------|--------------|---------------|
| `GET`    | `/health`                | gateway-api  | No            |
| `POST`   | `/api/auth/register`     | auth-service | No            |
| `POST`   | `/api/auth/login`        | auth-service | No            |
| `POST`   | `/api/auth/refresh`      | auth-service | No            |
| `DELETE` | `/api/auth/session`      | auth-service | No            |
| `GET`    | `/api/users/me`          | user-service | **Yes**       |
| `PATCH`  | `/api/users/me`          | user-service | **Yes**       |
| `POST`   | `/api/users/me/avatar`   | user-service | **Yes**       |
| `GET`    | `/api/users/:id/stats`   | user-service | **Yes**       |
| `GET`    | `/api/users/:id/matches` | user-service | **Yes**       |

The `/api/auth` prefix is stripped before proxying — auth-service receives `/register`, `/login`, etc. (see [auth-service README](../auth-service/README.md)).
The `/api/users` prefix is stripped similarly — user-service receives `/me`, `/:id/stats`, etc.

## Testing

### Unit tests

Independent of the Docker/native choice below — these mock the JWT plugin and the upstream proxy, no service needs to be running.

```bash
cd services/gateway-api
npm install # if you don't already have node_modules
npm test
```

4 files and 39 tests should pass.

### Docker (full Compose stack)

See the [root README](../../README.md#prerequisites) — `make up` starts the full stack, `docker ps -a` should show all 9 containers healthy (8 services + postgres), and the app is playable at `https://localhost`.

To hit gateway-api directly instead of through nginx (e.g. this service's own smoke test), uncomment its `127.0.0.1:4010:4000` port mapping in the root `docker-compose.yml` (marked `# Native dev only`) and recreate it:

```bash
docker compose -p mypong up -d gateway-api
```

gateway-api is then reachable at `http://localhost:4010`.

### Local (native)

Before starting, uncomment auth-service's `127.0.0.1:4001:4001` port mapping in the root `docker-compose.yml` (marked `# Native dev only`) — gateway-api's `.env.example` points `AUTH_SERVICE_URL` at `http://localhost:4001`; without this uncommented, every request through the native gateway-api fails with connection refused.

```bash
docker compose -p mypong up -d auth-service
```

If this is a fresh database (new Postgres volume), run auth-service's migrations once — see the [root README](../../README.md#prerequisites) for the full migration sequence. Skip this if you already ran `make up` before and the volume persisted.

gateway-api runs with Node; auth-service and Postgres run via `make up`. user-service stays in Docker (no native flow) — since gateway-api proxies `/api/users/*` to it (see Endpoints above), those routes won't be reachable while gateway-api runs natively. `USER_SERVICE_URL` in `.env` is still required for gateway-api to boot (see `.env.example`); test `/api/users/*` via `make up` instead.

Stop the Docker gateway-api first, to free the port:

```bash
docker compose -p mypong stop gateway-api
```

This flow uses its own `.env` file, separate from the root one used by Docker:

```bash
cd services/gateway-api
cp .env.example .env   # fill in JWT_SECRET — must match auth-service/.env
```

```bash
npm install # if not already done for unit tests
set -a && source .env && set +a
npm run dev   # http://localhost:4000 (or 4010 if PORT=4010 in .env)
```

> **Note**: `npm run dev` runs in watch mode and occupies the terminal — it
> won't return your prompt. Open a **second terminal** for the commands below
> (and don't source this service's `.env` there, to avoid the shadowing risk
> noted next).

> **Warning**: same shell-export risk as in
> [auth-service](../auth-service/README.md#local-native-faster-iteration) —
> sourcing `.env` here and then running `make up` in the same terminal can
> shadow the root `.env`. Open a new terminal for `make up`, or unset first:
> ```bash
> unset PORT JWT_SECRET AUTH_SERVICE_URL
> ```

Quick manual check, from that second terminal:

```bash
curl -i -X POST http://localhost:4010/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"wrongpassword"}'
```

Expected: `401 { "error": "Invalid credentials" }` — confirms gateway-api (native) is correctly reaching auth-service (Docker) through the uncommented port.

### Smoke test

Requires gateway-api running, either in Docker (`4010`) or natively (whichever port is in `.env`).

```bash
cd services/gateway-api
./scripts/smoke-test.sh                       # PORT=4000
./scripts/smoke-test.sh http://localhost:4010 # PORT=4010 (macOS with nxd)
```

4 cases: health check and three JWT deny cases (`/api/users/me` without auth, with malformed token, without Bearer prefix). Auth flow is covered by the auth-service smoke test.
