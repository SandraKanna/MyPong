# game-service

Owns the real-time physics of a Pong match while it's in progress: ball, paddles, score, end conditions. A pure WebSocket client with no database and no persistence — match state lives in memory only, for the lifetime of the connection.

How it receives match assignments from match-service, and how it reports the final result back, isn't modeled yet — expected to happen through gateway-ws messages, not direct service calls.

## Endpoints

| Method | Path      | Description                                  
|--------|-----------|-----------------------------------------------
| `GET`  | `/health` | Returns `200 { status: 'ok' }`. Used by Docker's healthcheck only — not part of the public API.

This is a native Node HTTP server, separate from the WebSocket client logic — game-service does not run Fastify and exposes no other HTTP routes. Everything else happens over its outbound WebSocket connection to gateway-ws (not modeled yet).

## Testing

### Unit tests

```bash
cd services/game-service
npm install # if you don't already have node_modules
npm test
```

### Docker (full Compose stack)

Runs game-service as a container alongside gateway-ws. No database involved — game-service has no `DATABASE_URL` and no `depends_on: postgres`.

Assumes the root `.env` is already set up (see the [root README](../../README.md#prerequisites)).

```bash
make up   # starts the full stack, including game-service
```

game-service has no host port mapping — it's only reachable from other containers on `backend-net`, at `game-service:4501`. To check the healthcheck from the host:

```bash
docker compose -p mypong exec game-service wget -qO- http://127.0.0.1:4501/health
```

### Local (native, faster iteration)

game-service runs directly with Node. No database to start — only gateway-ws needs to be reachable. If the full stack is already running via `make up`, stop just the game-service container (leave gateway-ws and the rest running):

```bash
docker compose -p mypong stop game-service
```

This flow uses its own `.env` file, separate from the root one used by Docker. `GATEWAY_WS_URL` already defaults to `ws://localhost:4500` for native dev — only `INTERNAL_SERVICE_SECRET` needs filling in, and it must match the value in the root `.env` (it's a shared secret across every service that authenticates against gateway-ws, not service-specific):


```bash
cd services/game-service
cp .env.example .env   # fill in INTERNAL_SERVICE_SECRET — copy the value from the root .env
```

```bash
npm install # if not already done for unit tests
set -a && source .env && set +a   # exports PORT, GATEWAY_WS_URL, INTERNAL_SERVICE_SECRET
npm run dev                        # health server on http://localhost:4501
```

> **Warning**: if you sourced `.env` here and then switch to `make up` in the
> same terminal, the shell-exported variables override what Docker Compose
> reads from the root `.env`. Open a new terminal for `make up`, or unset the
> variables first:
> ```bash
> unset PORT GATEWAY_WS_URL INTERNAL_SERVICE_SECRET
> ```

### Smoke test

None yet — game-service currently has no business logic to exercise beyond the healthcheck, which the unit tests already cover. A smoke test makes sense once the gateway-ws connection and match logic exist.