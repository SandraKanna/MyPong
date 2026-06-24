# gateway-api

REST gateway: validates JWT access tokens and proxies authenticated requests to
upstream services. The only entry point for the frontend — no business logic,
no database.

## Endpoints

All routes are under `/api/`. Public routes pass through without JWT validation;
protected routes require a valid `Authorization: Bearer <access_token>` header.

| Method   | Path                   | Target       | Auth required |
|----------|------------------------|--------------|---------------|
| `GET`    | `/health`              | gateway-api  | No            |
| `POST`   | `/api/auth/register`   | auth-service | No            |
| `POST`   | `/api/auth/login`      | auth-service | No            |
| `POST`   | `/api/auth/refresh`    | auth-service | No            |
| `DELETE` | `/api/auth/session`    | auth-service | No            |
| `GET`    | `/api/users/*`         | user-service | **Yes**       |

The `/api/auth` prefix is stripped before proxying — auth-service receives
`/register`, `/login`, etc. (see [auth-service README](../auth-service/README.md)).

## Environment variables

Create `services/gateway-api/.env` (gitignored):

```
PORT=4000
JWT_SECRET=<min 32 chars — must be identical to the value in auth-service/.env>
AUTH_SERVICE_URL=http://localhost:4001
```

`JWT_REFRESH_SECRET` must **never** appear here — gateway-api only validates
access tokens and has no knowledge of refresh token signing.

> **macOS + nxd**: if port 4000 is taken, use `PORT=4010` — see Testing below.

## Testing

### Docker (full Compose stack)

```bash
make up   # starts postgres + auth-service + gateway-api
```

Published on the host as `4010:4000` (port 4000 is commonly taken on macOS
by the Nx daemon, `nxd`) — the container still listens on 4000 internally.

The database starts empty — run migrations once:

```bash
docker compose -p mypong exec auth-service npx node-pg-migrate up
```

gateway-api is available at `http://localhost:4010` once started.

### Local (native)

gateway-api runs with Node; auth-service and Postgres run via `make up`.

```bash
# 1. Root .env — required by make up (skip if already created)
cp .env.example .env   # fill in JWT_SECRET, JWT_REFRESH_SECRET, POSTGRES_PASSWORD

# 2. Start the base stack (postgres + auth-service + gateway-api in Docker)
make up

# 3. Run migrations if the database is empty (once per fresh volume)
docker compose -p mypong exec auth-service npx node-pg-migrate up

# 4. Stop the Docker gateway-api to free the port for the native process
docker compose -p mypong stop gateway-api

# 5. Service .env — required by npm run dev
cd services/gateway-api
cp .env.example .env   # fill in JWT_SECRET (must match root .env) and PORT

# 6. Install dependencies and start
npm install
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

Requires the base stack (`make up` + migrations) and gateway-api running.
The script's default URL is `http://localhost:4000` — pass an argument if
gateway-api is on a different port:

```bash
cd services/gateway-api

# Docker mode (port published as 4010:4000 — default :4000 will not work)
./scripts/smoke-test.sh http://localhost:4010

# Native mode — use whichever port is in services/gateway-api/.env
./scripts/smoke-test.sh                       # PORT=4000
./scripts/smoke-test.sh http://localhost:4010 # PORT=4010 (macOS with nxd)
```

8 cases: register → login → refresh → logout via proxy, health check, and three
JWT deny cases (`/api/users/me` without auth, with malformed token, without
Bearer prefix).
