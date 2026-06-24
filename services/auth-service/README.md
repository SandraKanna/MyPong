# auth-service

Handles registration, login, token refresh, and logout. Issues short-lived JWT
access tokens (15 min) and rotating refresh tokens (7 days) stored in Postgres.

## Endpoints

| Method   | Path        | Description                                     |
|----------|-------------|-------------------------------------------------|
| `POST`   | `/register` | Create account — email + password (argon2 hash) |
| `POST`   | `/login`    | Returns access token + refresh token            |
| `POST`   | `/refresh`  | Rotates refresh token, returns new pair         |
| `DELETE` | `/session`  | Revokes refresh token (logout)                  |

These paths are without the `/api/auth` prefix — that prefix is added by
gateway-api when proxying. Direct calls to auth-service use the bare paths.

## Environment variables

Create `services/auth-service/.env` (gitignored):

```
PORT=4001
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/mypong
JWT_SECRET=<min 32 chars>
JWT_REFRESH_SECRET=<min 32 chars, different from JWT_SECRET>
```

## Testing

### Docker (full Compose stack)

Runs auth-service as a container alongside Postgres. Both use the Docker
internal network — do not run this and the native flow at the same time (both
bind port 4001).

```bash
cp .env.example .env   # fill in JWT_SECRET, JWT_REFRESH_SECRET, DB credentials
make up                # starts postgres + auth-service
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

```bash
# Skip if mypong-pg-dev already exists — check with: docker ps -a
docker run --name mypong-pg-dev \
  -e POSTGRES_DB=mypong -e POSTGRES_USER=mypong_user -e POSTGRES_PASSWORD=dev_password \
  -p 5433:5432 -d postgres:16-alpine

cd services/auth-service
set -a && source .env && set +a   # exports DATABASE_URL, JWT_SECRET, etc.
npm run migrate:up
npm run dev                        # http://localhost:4001
```

`DATABASE_URL` in `services/auth-service/.env` must point to `localhost:5433`
(the standalone container), not `postgres:5432` (the Compose internal hostname,
unreachable outside Docker).

> **Warning**: if you sourced `.env` here and then switch to `make up` in the
> same terminal, the shell-exported `DATABASE_URL` overrides what Docker Compose
> reads from the root `.env`. Open a new terminal for `make up`, or unset the
> variables first:
> ```bash
> unset DATABASE_URL JWT_SECRET JWT_REFRESH_SECRET
> ```

### Smoke test

Works against either setup above, once auth-service is up:

```bash
cd services/auth-service
./scripts/smoke-test.sh   # 9 cases: register, login, refresh, logout + deny cases
```
