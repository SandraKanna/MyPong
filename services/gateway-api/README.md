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

### Docker (full Compose stack)

Assumes the root `.env` is already set up (see the [root README](../../README.md#prerequisites)).

```bash
make up   # starts the full stack (all 8 services available today)
```

gateway-api is normally reached only through nginx (`/api/*`) — no other service or the browser should call it directly. The host port mapping below is a deliberate, temporary exception for two dev-time needs: the native Vite proxy (`/api` → `:4010` in `vite.config.ts`) when running the frontend outside Docker, and this service's own smoke test. It's tracked for removal once both of those go through nginx instead (see the `TODO` above `gateway-api`'s `ports:` in `docker-compose.yml`).

Published on the host as `4010:4000` (port 4000 is commonly taken on macOS by the Nx daemon, `nxd`) — the container still listens on 4000 internally.

The database starts empty — run migrations once:

```bash
docker compose -p mypong exec auth-service npx node-pg-migrate up --migrations-table pgmigrations_auth
```

gateway-api is available at `http://localhost:4010` once started.

### Local (native)

gateway-api runs with Node; auth-service and Postgres run via `make up` (user-service also needs to be running for `/api/users/*` routes to reach their upstream — it has no host port mapping and no native flow, so it must stay in Docker). `USER_SERVICE_URL` in `.env.example` is a placeholder that only lets gateway-api boot (Zod requires it) — it doesn't actually resolve, so `/api/users/*` will fail with a connection error in this mode; test those routes via `make up` instead.
Stop the Docker gateway-api first if it's running, to free the port:

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

> **Warning**: same shell-export risk as in
> [auth-service](../auth-service/README.md#local-native-faster-iteration) —
> sourcing `.env` here and then running `make up` in the same terminal can
> shadow the root `.env`. Open a new terminal for `make up`, or unset first:
> ```bash
> unset PORT JWT_SECRET AUTH_SERVICE_URL
> ```

### Smoke test

Requires gateway-api running, either in Docker (`4010`) or natively (whichever port is in `.env`).

```bash
cd services/gateway-api
./scripts/smoke-test.sh                       # PORT=4000
./scripts/smoke-test.sh http://localhost:4010 # PORT=4010 (macOS with nxd)
```

4 cases: health check and three JWT deny cases (`/api/users/me` without auth, with malformed token, without Bearer prefix). Auth flow is covered by the auth-service smoke test.
