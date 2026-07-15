# ai-bot-service

AI opponent for PvE matches — guest play (no account) or solo practice for logged-in users. Connects to gateway-ws as a WebSocket client, same pattern as game-service and match-service: no port of its own, no HTTP server, no inbound connections.

Sessions are fully ephemeral: no `DATABASE_URL`, no persistence of any kind. When a session or connection ends, all bot state for that match is discarded — nothing survives a restart (see Gotchas below for what this means on a crash).

## Environment variables

- `GATEWAY_WS_URL` — WebSocket URL of gateway-ws to connect to as a client
- `INTERNAL_SERVICE_SECRET` — shared secret used in the `service:register` handshake with gateway-ws

See `.env.example` for the full list with explanatory comments. Note: this service has no native (non-Docker) testing flow — see Local (native) below — so `.env.example` documents the variables for reference, but isn't exercised via a `cp .env.example .env` step the way other services' are.

## Message contract

ai-bot-service both receives and sends messages through gateway-ws, routed by type prefix.

Received (`ai-bot:` prefix — routes to this service):
- `ai-bot:sessionStart` — `{ matchId, difficulty, botSide, physicsConfig }`. Starts tracking a new PvE session.
- `ai-bot:state` — `{ matchId, ball, paddles, score }`. One per game tick; drives the bot's paddle decisions.
- `ai-bot:sessionEnd` — `{ matchId }`. Tears down all in-memory state for that session.

Sent (`game:` prefix — routes to game-service, **not** `ai-bot:input`):
- `game:botInput` — `{ matchId, direction }`. The bot's paddle move for the current tick.

> The outbound prefix is `game:`, naming the destination, not `ai-bot:` — see [gateway-ws's routing rules](../gateway-ws/README.md#routing). Unlike browser-facing messages (routed via `to:`), this is pure service-to-service traffic with no `to` field, so the prefix is the only routing signal.

Difficulty presets (bot behavior only — see Gotchas for what this does *not* control) live in `botConfig.ts`, tuned by playtest rather than fixed — see that file for current values. `easy` additionally misses on purpose ~50% of the time regardless of score.

Difficulty is expressed in two separate phases: how often the bot re-aims (`updateIntervalMs`, gated) versus how often it corrects its direction toward that aim (every physics tick, ungated). A bang-bang controller needs to correct at the real physics cadence or it oscillates regardless of threshold size — only the aim cadence should vary by difficulty.

## Healthcheck

ai-bot-service has no HTTP server. Docker tracks liveness via a file, same pattern as game-service and match-service: `internalClient` writes `/tmp/healthy` when the gateway-ws connection is established and deletes it on disconnect.

`test: ["CMD-SHELL", "test -f /tmp/healthy"]`

## Testing

### Unit tests

`BotSessionManager.test.ts` and `ballPredictor.test.ts`.

```bash
cd services/ai-bot-service
npm install   # if you don't already have node_modules
npm test
```

2 files and 32 tests should pass.

### Docker (full Compose stack)

No database involved — ai-bot-service has no `DATABASE_URL`.

Assumes the root `.env` is already set up (see the [root README](../../README.md#prerequisites)).

**Prerequisites:** `make up` (starts the full stack, including ai-bot-service).

**1. Confirm the container is healthy:**

```bash
docker compose -p mypong ps ai-bot-service   # Status column should show "healthy"
```

**2. Confirm the bot actually plays** — this exercises the full PvE path (gateway-ws routing + game-service physics + ai-bot-service decisions), not just container liveness:

1. Open `https://localhost` in your browser.
2. Play vs AI as a guest from the home page, or log in and pick a difficulty in the Play tab.
3. Watch the opponent paddle for a few seconds without touching any input — it should track the ball and move on its own.

<img src="../../docs/img/ai-bot-service-pve-match.png" alt="PvE match with the AI-controlled paddle in play" width="500">

### Smoke test

Isolated: `services/ai-bot-service/scripts/smoke-test.mjs` — proves ai-bot-service's own decision logic and WS message contract using synthetic ball/paddle state, no physics loop involved. Registers itself **as `game-service`** with gateway-ws (not `test-service`) — see [gateway-ws's routing](../gateway-ws/README.md#routing): gateway-ws routes service-to-service messages with no fan-out, only to whoever currently holds that name's registration slot, so this script has to occupy it to observe `game:botInput` at all.

**Setup (required — do not skip):**

1. `docker compose -p mypong stop game-service` — frees the registration slot this script needs to occupy.

> **Skipping this orphans the real container.** gateway-ws keeps one socket per service name; a second registration under `game-service` overwrites the real container's entry immediately, with no error on either side. The healthcheck can't catch this — it only detects a dead process or closed connection, not a live one silently cut out of routing. No auto-recovery. Cleanup step is always needed.

**Run:**

```bash
INTERNAL_SERVICE_SECRET=<value> node services/ai-bot-service/scripts/smoke-test.mjs
# or with an explicit URL:
INTERNAL_SERVICE_SECRET=<value> node services/ai-bot-service/scripts/smoke-test.mjs ws://localhost:4500
```

5 cases: ball above paddle center → `direction: up`, ball below center → `direction: down`, `ai-bot:sessionEnd` tears down state, state for a never-started matchId is silently ignored, clean shutdown.

**Cleanup:**

```bash
docker compose -p mypong start game-service
```

The script's own `finally` block only closes its WebSocket — it never calls `docker compose` itself (same contract as every other smoke test in this repo). Restarting the real container is always a manual step.

> This isolated test doesn't prove `game:botInput` actually moves a real paddle — no physics loop here to apply it to. For that, see [game-service's smoke test](../game-service/README.md#smoke-test), which chains ai-bot-service's decisions + gateway-ws routing + game-service's physics end-to-end.

### Local (native)

Not applicable. This service has no HTTP server, no host port, and nothing to reach it with except gateway-ws — it only makes sense running inside the Compose network, so there's no faster-iteration native flow like the other WS-client services have.

## Gotchas / known limitations

- **Ball/paddle speed by difficulty is not configured here.** Difficulty-based physics overrides (easy: `ballInitialSpeed=6`; hard: `ballInitialSpeed=11`, `paddleSpeed=9`) live in game-service's `GameSessionManager.pvePhysicsOverrides()`, isolated from PvP. ai-bot-service only controls bot *behavior* (tracking error, reaction delay, decision cadence) — not ball or paddle speed.
- **No reconnection or rehydration on crash.** If ai-bot-service crashes mid-session, the bot's paddle freezes in place. The human player has to abandon and start a new match — there's no session recovery. Accepted risk at this project's scale, not mitigated.
- **`PhysicsConfig` structural drift (known, unresolved).** The local `PhysicsConfig` interface here has 7 fields; game-service's version has 4 more (`ballInitialSpeed`, `ballMinSpeedFactor`, `ballMaxSpeedFactor`, `maxScore`). Those extra fields arrive over `ai-bot:sessionStart` but are silently discarded — the payload is cast, not structurally validated, so this doesn't surface as a compile error. Flagged for cleanup, not yet fixed.

