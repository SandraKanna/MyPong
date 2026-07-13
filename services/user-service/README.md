# user-service

Manages user profiles, avatar uploads, and match statistics. It's mostly a REST API — profile reads and writes go through HTTP like any other service — but it also connects to gateway-ws as an internal WebSocket client, so it can listen for `user:matchRecorded` events and keep stats and match history up to date in real time. That connection is automatic on boot; there's nothing to configure or trigger manually on the WS side.


## Endpoints

All paths below are relative to `/api/users/*`, since gateway-api proxies everything under that prefix. Clients authenticate with a normal `Authorization: Bearer <access_token>` header, same as any other protected route. gateway-api validates that token and then talks to user-service internally over `x-user-id` — user-service itself never sees or decodes the JWT, it just trusts that header.


| Method   | Path            | Auth required | Description                                                       
|----------|-----------------|---------------|-------------------------------------------------------------------
| `GET`    | `/?ids=1,2,3`   | Yes           | Batch profile lookup (max 50 ids); unknown/profile-less ids silently omitted 
| `GET`    | `/me`           | Yes           | Returns own profile; `404` if no profile row yet                  
| `PATCH`  | `/me`           | Yes           | Creates or updates username (first call creates the profile row)  
| `POST`   | `/me/avatar`    | Yes           | Multipart upload; resizes to 512×512 WebP; requires prior PATCH   
| `GET`    | `/:id/stats`    | Yes           | Any user's stats; returns zeroed defaults if no matches recorded  
| `GET`    | `/:id/matches`  | Yes           | Any user's match history; `?limit=` (max 50) `?offset=` (default 20/0)

## Environment variables

| Variable                   | Description                                                                 |
|----------------------------|-----------------------------------------------------------------------------|
| `PORT`                     | HTTP port user-service listens on (default in Docker: `4002`)               |
| `DATABASE_URL`             | Postgres connection string                                                  |
| `AVATARS_DIR`              | Directory where avatar files are stored (Docker: `/var/www/avatars`)        |
| `GATEWAY_WS_URL`           | WebSocket URL for gateway-ws (Docker: `ws://gateway-ws:4500`)               |
| `INTERNAL_SERVICE_SECRET`  | Shared secret for gateway-ws authentication — must match the root `.env`    |

## Testing

### Unit tests

Independent of Docker — these mock the database and don't need any service running.

```bash
cd services/user-service
npm install # if you don't already have node_modules
npm test
```

### Docker (full Compose stack)

Assumes the root `.env` is already set up (see the [root README](../../README.md#prerequisites)).

```bash
make up   # starts the full stack, including user-service
```

user-service has **no host port mapping** — port 4002 is only reachable from other containers on `backend-net`. To test the HTTP surface against the real stack, go through gateway-api with a valid access token:

```bash
curl -H "Authorization: Bearer <access_token>" http://localhost:4010/api/users/me
```

The WebSocket client connects to gateway-ws automatically on boot (gateway-ws is a `depends_on`) — no manual step needed for the WS side.

The database starts empty — run both sets of migrations once:

```bash
# Required for the users table FK (user-service's tables reference auth-service's users):
docker compose -p mypong exec auth-service npx node-pg-migrate up --migrations-table pgmigrations_auth
# user-service's own tables (user_profiles, user_stats, user_match_history):
docker compose -p mypong exec user-service npx node-pg-migrate up --migrations-table pgmigrations_user
```

### Smoke test

Runs via gateway-api (default: `:4010`) — user-service has no host port mapping (not reachable directly from the HOST), so the full Docker stack must be running. Requires both migration sets applied (see Docker section above).

```bash
cd services/user-service
./scripts/smoke-test.sh                         # default: http://localhost:4010
./scripts/smoke-test.sh http://localhost:4010   # explicit
```

12 cases in total: two deny cases for missing `Authorization` headers on `/me`, the profile lifecycle (404 before a username is set, then PATCH, then a successful 200), an invalid-username rejection, zeroed stats for a user with no matches, an empty match history, a rejected `limit=51` (over the max), a rejected non-numeric `:id`, one more deny case confirming `/:id/stats` also requires a token, and a batch lookup (`GET /?ids=...`) confirming the caller's own id comes back and an unknown id is silently omitted.
