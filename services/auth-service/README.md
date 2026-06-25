# auth-service

Handles registration, login, token refresh, and logout. Issues short-lived JWT
access tokens (15 min) and rotating refresh tokens (7 days) stored in Postgres.

## Endpoints

| Method   | Path        | Description                                     |
|----------|-------------|-------------------------------------------------|
| `POST`   | `/register` | Create account — email + password (argon2 hash) |
| `POST`   | `/login`    | Returns access token in body; refresh token as httpOnly cookie  |
| `POST`   | `/refresh`  | Returns new access token in body, rotates refresh cookie        |
| `DELETE` | `/session`  | Revokes refresh token (logout)                  |

These paths are without the `/api/auth` prefix — that prefix is added by
gateway-api when proxying. Direct calls to auth-service use the bare paths.


## Testing

### Unit tests

Independent of the Docker/native choice below — these mock the database and
don't need any service running.

```bash
cd services/auth-service
npm install # if you don't already have node_modules
npm test
```

### Docker (full Compose stack)

Runs auth-service as a container alongside Postgres. Both use the Docker
internal network — do not run this and the native flow at the same time (both
bind port 4001).

Assumes the root `.env` is already set up (see the [root README](../../README.md#prerequisites)).

```bash
make up   # starts postgres + auth-service
```

The database starts empty — run migrations once:

```bash
docker compose -p mypong exec auth-service npx node-pg-migrate up
```

auth-service is available at `http://localhost:4001` once healthy.
Stop with `make down` before switching to the native flow.

### Local (native, faster iteration)

auth-service runs directly with Node. Only Postgres runs in Docker, in a
standalone container on port 5433 (separate from the Compose one — both can
coexist).

This flow uses its own `.env` file, separate from the root one used by Docker:

```bash
cd services/auth-service
cp .env.example .env   # fill in JWT_SECRET and JWT_REFRESH_SECRET. Credentials here must match the docker run command below
```

```bash
# Skip if mypong-pg-dev already exists — check with: docker ps -a
docker run --name mypong-pg-dev \
  -e POSTGRES_DB=mypong -e POSTGRES_USER=mypong_user -e POSTGRES_PASSWORD=dev_password \
  -p 5433:5432 -d postgres:16-alpine

npm install # if not already done for unit tests
set -a && source .env && set +a   # exports DATABASE_URL, JWT_SECRET, etc.
npm run migrate:up
npm run dev                        # http://localhost:4001
```

> **Warning**: if you sourced `.env` here and then switch to `make up` in the
> same terminal, the shell-exported `DATABASE_URL` overrides what Docker Compose
> reads from the root `.env`. Open a new terminal for `make up`, or unset the
> variables first:
> ```bash
> unset DATABASE_URL JWT_SECRET JWT_REFRESH_SECRET
> ```

### Smoke test

Runs against gateway-api (default: `:4010`) — the cookie has `Path=/api/auth`,
which only matches the gateway's `/api/auth/*` routes, not auth-service's bare
paths. Requires both auth-service and gateway-api running.

```bash
cd services/auth-service
./scripts/smoke-test.sh http://localhost:4010   # 10 cases: register, login, refresh, logout + deny cases
```