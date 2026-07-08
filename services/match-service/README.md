# match-service

Owns the match lifecycle: FIFO matchmaking queue, match creation in Postgres, and match closure (persisting result and emitting history events). A pure WebSocket client — it connects outbound to gateway-ws at startup and receives matchmaking and game events from there. No HTTP endpoints; healthcheck is file-based.

## Matchmaking and match lifecycle

**Queue**: on `match:join`, match-service checks whether the user already has an active match (`findActiveMatchForUser`) and sends `match:rejected` if so. Otherwise the user is added to the FIFO queue. On `match:cancel` or `player:disconnect`, the user is silently removed.

**Pairing**: when two players are queued, match-service dequeues both, calls `createMatch()` to insert a `match` row, and computes `startsAt` once (`Date.now() + 3s`). Two messages are sent in the same tick: `match:matched` fan-out to both browsers and `game:assign` routed to game-service — both carry the same `startsAt` value so the countdown is synchronized.

**Closure**: on `match:result` from game-service, match-service calls `closeMatch()` to update the match row (`scores`, `winner_id`, `status`, `closed_at`) and then emits `user:matchRecorded` to user-service. `user:matchRecorded` is only emitted after a successful `closeMatch()` — never on failure.

## Database

| Column | Type | Notes |
|--------|------|-------|
| `id` | serial (PK) | |
| `player1_id` | integer | No FK — cross-service FK would couple match-service to auth-service's schema |
| `player2_id` | integer | |
| `player1_score` | integer | Null until match is closed |
| `player2_score` | integer | |
| `winner_id` | integer | Null until match is closed |
| `status` | text | `'active'` on creation; `'completed'` or `'forfeit'` on closure |
| `created_at` | timestamp | Set by `now()` on insert |
| `closed_at` | timestamp | Null until match is closed |

Migrations table: `pgmigrations_match`.

## Messages

### Received (from gateway-ws)

| Type | Source | Description |
|------|--------|-------------|
| `match:join` | browser (via gateway-ws) | Enqueue user — rejected with `match:rejected` if already in an active match |
| `match:cancel` | browser (via gateway-ws) | Remove user from queue (no-op if not queued) |
| `player:disconnect` | gateway-ws | Remove disconnected user from queue |
| `match:result` | game-service (type-prefix routing) | Final scores — triggers `closeMatch()` and `user:matchRecorded` |

### Sent (to gateway-ws)

| Type | Destination | Description |
|------|-------------|-------------|
| `match:matched` | both players (`to: [id1, id2]`) | Match found: `{ matchId, players, startsAt }` |
| `match:rejected` | requester (`to: [userId]`) | Already in active match: `{ reason: 'already_in_match', message }` |
| `game:assign` | game-service (type-prefix routing) | Same payload as `match:matched` — triggers session creation in game-service |
| `user:matchRecorded` | user-service (type-prefix routing) | Same shape as `match:result` — triggers stats/history recording in user-service |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GATEWAY_WS_URL` | Yes | WebSocket URL of gateway-ws — `ws://gateway-ws:4500` in Docker, `ws://localhost:4500` in native dev |
| `INTERNAL_SERVICE_SECRET` | Yes | Shared secret used to authenticate with gateway-ws on connect |

## Healthcheck

match-service has no HTTP server. Docker tracks liveness via a file: `internalClient` writes `/tmp/healthy` when the gateway-ws connection is established and deletes it on disconnect. The Docker healthcheck is:

```
test: ["CMD-SHELL", "test -f /tmp/healthy"]
```

## Testing

### Unit tests

32 tests covering the matchmaking queue (FIFO pairing, duplicate-join guard, cancel, disconnect cleanup), `match.service` (createMatch, closeMatch, findActiveMatch), the `matchResult` handler, and the WS internal client.

```bash
cd services/match-service
npm install   # if you don't already have node_modules
npm test
```

### Docker (full Compose stack)

Assumes the root `.env` is already set up (see the [root README](../../README.md#prerequisites)).

```bash
make up   # starts the full stack, including match-service
```

match-service has no host port mapping. Run migrations once after the stack is healthy:

```bash
docker compose -p mypong exec match-service npx node-pg-migrate up --migrations-table pgmigrations_match
```

To confirm it's healthy:

```bash
docker compose -p mypong ps match-service   # Status column should show "healthy"
```

### Local (native, faster iteration)

match-service connects outbound to gateway-ws and Postgres — no FK dependencies on auth-service's schema, so it can run with a standalone Postgres instance alongside the rest of the Docker stack. If the full stack is already running via `make up`, stop just the match-service container first:

```bash
docker compose -p mypong stop match-service
```

```bash
# Skip if mypong-pg-dev already exists — check with: docker ps -a
docker run --name mypong-pg-dev \
  -e POSTGRES_DB=mypong -e POSTGRES_USER=mypong_user -e POSTGRES_PASSWORD=dev_password \
  -p 5433:5432 -d postgres:16-alpine
```

```bash
cd services/match-service
cp .env.example .env   # fill in INTERNAL_SERVICE_SECRET — copy the value from the root .env
npm install             # if not already done for unit tests
set -a && source .env && set +a
npm run migrate:up
npm run dev             # connects to GATEWAY_WS_URL on start; /tmp/healthy written when connected
```

> **Warning**: if you sourced `.env` here and then switch to `make up` in the same terminal, the shell-exported variables override what Docker Compose reads from the root `.env`. Open a new terminal for `make up`, or unset the variables first:
> ```bash
> unset DATABASE_URL GATEWAY_WS_URL INTERNAL_SERVICE_SECRET
> ```

### Smoke test

Requires the full stack running with migrations applied (see Docker section above).

```bash
node services/match-service/scripts/smoke-test.mjs
# or with explicit URLs:
node services/match-service/scripts/smoke-test.mjs ws://localhost:4500 http://localhost:4010
```

7 cases: browser1 authenticates, browser2 authenticates, `match:join` pairing both players into `match:matched` (correct matchId and side assignments), `match:cancel` preventing a match from being made, `match:rejected` for an already-matched user (shape: `reason: 'already_in_match'`, message present), rejection not re-enqueuing the user, and clean shutdown.

> **Known side effect**: the smoke test leaves a `match:result` with `status: 'forfeit'` and score `0–0` in `user_match_history` when the sockets close after `match:matched` — the disconnect mid-match triggers the same forfeit path as a real disconnection. This is pre-existing game-service behavior that becomes visible here now that user-service consumes `user:matchRecorded`.
