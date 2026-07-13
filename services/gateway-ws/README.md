# gateway-ws

WebSocket hub: authenticates browser connections via JWT, authenticates internal service connections via shared secret, and routes messages between them. No database, no REST endpoints — stateless except for open socket handles. The only HTTP endpoint is `/health` for the Docker healthcheck.

## Browser connection

Browsers connect to `wss://<host>/ws` through nginx, which terminates TLS and proxies the upgrade to gateway-ws. **Do not connect to port 4500 directly in production** — the port mapping in `docker-compose.yml` is a temporary development convenience (marked TODO for removal).

| Step | Direction | Message |
|------|-----------|---------|
| 1 | Client → Server | TCP + WebSocket upgrade (no auth yet) |
| 2 | Client → Server | `{ "type": "auth", "payload": { "token": "<access_token>" } }` — must be sent within **5 seconds** of connecting |
| 3 | Server → Client | `{ "type": "connected", "payload": { "userId": <id> } }` — connection is now authenticated |

If authentication fails, the server closes the socket with one of these codes (application-reserved range per RFC 6455):

| Code | Reason |
|------|--------|
| `4001` | Unauthorized — token missing, invalid, expired, wrong type, or 5s timeout exceeded without sending an auth message |
| `4003` | Bad Request — first message is not valid JSON, or does not have the required `{ type, payload.token }` shape |
| `4009` | Session Replaced — a newer browser connection authenticated with the same `userId` (see "Single session per user" below) |

The `type` claim in the token is verified in addition to the signature — a refresh token is rejected even if the secret matches, as a defense against misconfiguration.

## Single session per user

gateway-ws maintains one browser socket per `userId`. When a second browser connection authenticates with a `userId` that already has one, the previous connection is closed with code `4009` (reason: `"Session replaced by a newer connection"`) before the new one is registered — there is no window where the `userId` has neither a valid old nor new entry, since both the close and the registration happen synchronously within the same message handler.

`player:disconnect` for the replaced session is broadcast to all registered services immediately, at replacement time — not deferred until the old socket's own `close` event fires. That event is asynchronous and could otherwise arrive after the new session's `player:connect` broadcast, and services would see a connect before its matching disconnect. In particular, game-service's reconnect handling only resumes a session that is already marked disconnected for that `userId`; a `player:connect` with nothing to resume is a no-op, and a `player:disconnect` arriving afterward would then pause (or, in PvE, silently tear down with no `game:end`) a session that actually has a live browser attached, with no further event to ever recover it. Enforcing disconnect-before-connect ordering here means the replaced session flows through the exact same grace-window/forfeit/queue-removal handling any other disconnect gets — no special-casing needed downstream.

When the old socket's own `close` event does eventually fire, it checks whether the `userId` entry in the connection map still points at that same socket before doing anything — since the replacement above already reassigned the entry to the new socket, this check fails and the handler is a no-op (no deleting the new session's entry, no re-broadcasting an already-handled disconnect).

This differs from the service-registration path below, which still silently orphans a superseded socket without closing it — see the Gotchas section.

## Internal service connection

Backend services (game-service, match-service, user-service) connect to gateway-ws at startup using a shared secret, not a JWT. The same auth-by-first-message protocol applies: the registration message must arrive within 5 seconds of the TCP upgrade, or the socket is closed with code 4001.

| Step | Direction | Message |
|------|-----------|---------|
| 1 | Service → gateway-ws | TCP + WebSocket upgrade |
| 2 | Service → gateway-ws | `{ "type": "service:register", "service": "<name>", "token": "<INTERNAL_SERVICE_SECRET>" }` |
| 3 | gateway-ws → Service | `{ "type": "registered" }` — connection is now authenticated |

`service` must be one of the known names: `game-service`, `match-service`, `user-service`, `test-service` (reserved for smoke tests — see Gotchas). Any other name is rejected with code 4001.

gateway-ws maintains one socket per service name. A second registration under the same name overwrites the Map entry with the new socket — it does NOT close the original one. The real service's socket stays open and connected, but is silently orphaned from routing (gateway-ws no longer sends it anything). If the impostor's connection later closes, its cleanup handler deletes the service-name entry entirely (since the Map still pointed at it), leaving the real service completely unrouted with no error and no automatic recovery — it never reconnects on its own, because from its own perspective its connection never dropped.

When a browser client connects or disconnects, gateway-ws emits `player:connect` / `player:disconnect` to all registered services, carrying the `userId` of the affected browser.

## Routing

gateway-ws routes messages between browsers and services with no business logic — it never modifies payloads.

**Service → browser fan-out** (`to` field): a service message with a `to: number[]` field is delivered to each userId in the array. The `to` field is stripped before delivery. This is how services push game events to specific browser clients.

**Service → service (type-prefix routing)**: a service message without a `to` field is routed by the prefix before the first `:` in the `type` field — e.g. `match:result` routes to `match-service`, `game:assign` routes to `game-service`. No rewriting of `type` or payload.

**Browser → service (userId injection)**: gateway-ws injects the authenticated `userId` into every message received from a browser before forwarding it to the target service (derived from the validated JWT, never from the payload). A client-supplied `userId` in the message body is ignored.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Yes | HTTP port for the `/health` endpoint |
| `JWT_SECRET` | Yes | Must match auth-service — used to verify browser access tokens |
| `INTERNAL_SERVICE_SECRET` | Yes | Shared secret used by internal services to authenticate |

## Testing

### Unit tests

Independent of Docker — no service needs to be running. Tests use a real `WebSocketServer` on an OS-assigned port and real JWT tokens; nothing is mocked.

```bash
cd services/gateway-ws
npm install   # if you don't already have node_modules
npm test
```

### Docker (full Compose stack)

Assumes the root `.env` is already set up (see the [root README](../../README.md#prerequisites)).

```bash
make up   # starts the full stack
```

gateway-ws has no database — no migrations are needed for this service. It is ready as soon as its healthcheck passes. For the smoke test and manual verification below, you still need auth-service migrated (gateway-ws needs a real JWT, which means a real registered user):

```bash
docker compose -p mypong exec auth-service npx node-pg-migrate up --migrations-table pgmigrations_auth
```

See [auth-service README](../auth-service/README.md) and [gateway-api README](../gateway-api/README.md) for full setup if those services aren't already running.

gateway-ws is published on the host as `4500:4500` (temporary, for direct testing — see TODO in `docker-compose.yml`).

### Local (native)

```bash
cd services/gateway-ws
cp .env.example .env   # fill in JWT_SECRET and INTERNAL_SERVICE_SECRET — must match the root .env values
npm install             # if not already done for unit tests
set -a && source .env && set +a
npm run dev              # ws://localhost:4500
```

> **If a Docker container for gateway-ws is already running** (e.g. from `make up`), it holds port 4500 on the host — stop it first or this fails with `EADDRINUSE`: `docker compose -p mypong stop gateway-ws`.
>
> **`set -a && source .env && set +a` only exports variables into that shell session.** If you open a new terminal to run gateway-ws again (not just to connect a client to it), repeat the `source .env` there too — otherwise Zod will reject the missing `PORT`/`JWT_SECRET` as `undefined`.
>
> Same shell-export risk as [auth-service](../auth-service/README.md#local-native-faster-iteration): sourcing `.env` here and then running `make up` in the same terminal can shadow the root `.env`. Open a new terminal for `make up`, or `unset PORT JWT_SECRET INTERNAL_SERVICE_SECRET` first.

### Smoke test

Requires the full stack running with migrations applied (see Docker section above). Talks to gateway-ws directly on its published port, and to gateway-api to obtain a real JWT.

```bash
node services/gateway-ws/scripts/smoke-test.mjs
# or with explicit URLs:
node services/gateway-ws/scripts/smoke-test.mjs ws://localhost:4500 http://localhost:4010
```

3 cases:
1. **Valid access token** → receives `{ type: "connected", payload: { userId: "..." } }`
2. **Invalid token** → socket closed with code 4001 (deny)
3. **No auth sent** → socket closed with code 4001 after the 5s timeout (deny) — this case takes ~5 seconds

### Manual verification

The smoke test confirms the protocol logic works, but bypasses nginx — it talks to gateway-ws directly. The check below is what actually proves the production path: browser → nginx (TLS termination + WebSocket upgrade) → gateway-ws.

**1. Get an access token** (full stack running, migrations applied):

```bash
curl -sk -X POST https://localhost/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ws-test@example.com","password":"Test1234!"}'

TOKEN=$(curl -sk -X POST https://localhost/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ws-test@example.com","password":"Test1234!"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

echo $TOKEN   # confirm it's non-empty
```

**2. Connect through nginx** (install wscat once if needed: `npm install -g wscat`):

```bash
wscat -c wss://localhost/ws -n   # -n skips TLS cert verification (self-signed dev cert)
```

**3. Once connected, paste the auth message and press Enter within 5 seconds:**

```json
{"type":"auth","payload":{"token":"<paste TOKEN here>"}}
```

**Expected response:**

```json
{"type":"connected","payload":{"userId":"<your user id>"}}
```

If the 5-second window passes before sending, the server closes with code 4001 — reconnect and paste faster. Also don't run `curl` while `wscat` is already connected and waiting — it'll be sent as the WS message itself, which isn't valid JSON, and the server correctly closes with 4003.

> **To isolate whether a failure is nginx's proxy config or gateway-ws itself:** repeat steps 2–3 against the native process instead (`npm run dev` from the previous section), connecting directly with `wscat -c ws://localhost:4500` (plain `ws://`, no `/ws` path, no TLS — nginx isn't in the path at all). Same token, same expected response. If this works but the nginx version doesn't, the bug is in `nginx.conf`'s `/ws` block, not in gateway-ws.

## Gotchas

**Smoke test must register as `test-service`, never as a real service name.** A second registration under the same name silently orphans the real service from routing (see "Internal service connection" above) — there's no error, no automatic recovery, and no reconnection, since the real service's own connection never actually drops. `test-service` is a reserved slot in KNOWN_SERVICES for this exact purpose.