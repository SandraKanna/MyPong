# game-service

Owns the real-time physics of a Pong match while it's in progress: ball, paddles, score, and end conditions. A pure WebSocket client — it connects outbound to gateway-ws at startup and receives match assignments, player input, and session events from there. No database, no REST endpoints, no inbound connections.

## Session lifecycle

1. **Match assigned**: match-service sends `game:assign` with `matchId`, `players` (user IDs mapped to sides), and `startsAt` (an ISO timestamp 3 seconds in the future). game-service records the pending match but does not create a session yet.

2. **Countdown and session creation**: when `startsAt` fires, game-service creates the session and starts the physics tick loop. Any `game:input` arriving before `startsAt` is a safe no-op (the session is not yet in the sessions Map).

3. **Player input**: `game:input` messages from gateway-ws carry an injected `userId`. game-service validates that the user belongs to the match before applying the direction to their paddle. Unknown users are silently ignored.

4. **Player disconnects mid-match**: `game.pause()` halts physics. game-service sends `game:paused` to the opponent with `graceEndsAt` (5 seconds from now). If the player reconnects within the grace window, `game.resume()` is called and `game:resumed` is sent to both. If the deadline expires, the disconnected player forfeits.

> **`game:state` doesn't stop during a pause.** The tick loop broadcasts every frame regardless of `isPaused` — positions freeze, but the messages keep arriving. Don't use `game:state` to detect that a match resumed; only `game:resumed` and `game:end` are reliable phase signals.

> **Paddle direction survives a pause.** A player's last `game:input` direction isn't cleared when the game pauses. If a client disconnects with a key held, the paddle keeps moving in that direction once the match resumes — a client should send `direction: 'stop'` before disconnecting deliberately (e.g. leaving the page) if any input is currently active.

5. **Match ends (score)**: when a player reaches the win threshold, game-service sends `game:end` to both players and emits `match:result` so match-service can close the match and persist the result.

6. **Forfeit**: if the mid-match grace window expires without reconnection, or if a countdown-window disconnect is never resolved by `startsAt`, game-service resolves the forfeit at that deadline — sends `game:end` to both players with `reason: 'forfeit'` and the real score (never invented), and emits `match:result`.

## Messages

### Received (from gateway-ws)

| Type | Source | Description |
|------|--------|-------------|
| `game:assign` | match-service | New match assigned: `{ matchId, players, startsAt }` |
| `game:input` | browser (via gateway-ws) | Paddle direction: `{ matchId, direction }` — `userId` injected by gateway-ws |
| `player:connect` | gateway-ws | Browser reconnected — triggers resume if within grace window |
| `player:disconnect` | gateway-ws | Browser disconnected — triggers grace timer or forfeit |

### Sent (to gateway-ws)

| Type | Destination | Description |
|------|-------------|-------------|
| `game:state` | both players (`to: [id1, id2]`) | Physics snapshot every tick: `{ matchId, ball, paddles, score }` |
| `game:paused` | opponent only (`to: [opponentId]`) | Player disconnected: `{ matchId, disconnectedUserId, graceEndsAt }` |
| `game:resumed` | both players (`to: [id1, id2]`) | Player reconnected in time: `{ matchId, ball, paddles, score }` |
| `game:end` | both players (`to: [id1, id2]`) | Match over: `{ matchId, winnerId, score, reason: 'completed' \| 'forfeit' }` |
| `match:result` | match-service (type-prefix routing) | Triggers persistence: `{ matchId, players, winnerId, score, status, startedAt, endedAt }` |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GATEWAY_WS_URL` | Yes | WebSocket URL of gateway-ws — `ws://gateway-ws:4500` in Docker, `ws://localhost:4500` in native dev |
| `INTERNAL_SERVICE_SECRET` | Yes | Shared secret used to authenticate with gateway-ws on connect |

## Healthcheck

game-service has no HTTP server. Docker tracks liveness via a file: `internalClient` writes `/tmp/healthy` when the gateway-ws connection is established and deletes it on disconnect. The Docker healthcheck is:

```
test: ["CMD-SHELL", "test -f /tmp/healthy"]
```

## Testing

### Unit tests

63 tests covering session lifecycle, physics tick, pause/reconnect grace window, forfeit, synchronized countdown, and outsider input rejection.

```bash
cd services/game-service
npm install   # if you don't already have node_modules
npm test
```

### Docker (full Compose stack)

No database involved — game-service has no `DATABASE_URL`.

Assumes the root `.env` is already set up (see the [root README](../../README.md#prerequisites)).

```bash
make up   # starts the full stack, including game-service
```

game-service has no host port mapping — it's only reachable from other containers on `backend-net`. To confirm it's healthy:

```bash
docker compose -p mypong ps game-service   # Status column should show "healthy"
```

### Local (native, faster iteration)

game-service connects outbound to gateway-ws — only gateway-ws needs to be reachable. If the full stack is already running via `make up`, stop just the game-service container (leave gateway-ws and the rest running):

```bash
docker compose -p mypong stop game-service
```

```bash
cd services/game-service
cp .env.example .env   # fill in INTERNAL_SERVICE_SECRET — copy the value from the root .env
npm install             # if not already done for unit tests
set -a && source .env && set +a
npm run dev             # connects to GATEWAY_WS_URL on start; /tmp/healthy written when connected
```

> **Warning**: if you sourced `.env` here and then switch to `make up` in the same terminal, the shell-exported variables override what Docker Compose reads from the root `.env`. Open a new terminal for `make up`, or unset the variables first:
> ```bash
> unset GATEWAY_WS_URL INTERNAL_SERVICE_SECRET
> ```

### Smoke test

Requires the full stack running with migrations applied. `INTERNAL_SERVICE_SECRET` must be set in the environment — it is not read from `.env` automatically when running from the repo root.

```bash
INTERNAL_SERVICE_SECRET=<value> node services/game-service/scripts/smoke-test.mjs
# or with explicit URLs:
INTERNAL_SERVICE_SECRET=<value> node services/game-service/scripts/smoke-test.mjs ws://localhost:4500 http://localhost:4010
```

9 cases: browser auth (2 players + 1 outsider), internal service registration as `test-service`, `game:assign` delivering `game:state` to both players, initial state shape validation, `game:input` moving the correct paddle, outsider input silently ignored, forfeit by disconnect with correct winner, and clean shutdown.

Note: the smoke test sends `game:assign` without `startsAt` — the session starts immediately (no countdown delay). This is intentional for isolation; the real countdown flow is covered by unit tests with fake timers.
