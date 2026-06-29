# gateway-ws

WebSocket hub: authenticates browser connections via JWT and will route messages to backend services (game-service, matchmaking-service, etc.) as they are implemented in later phases. No database, no REST endpoints — stateless except for open socket handles. The only HTTP endpoint is `/health` for the Docker healthcheck.

## Connection contract

Browsers connect to `wss://<host>/ws` through nginx, which terminates TLS and proxies the upgrade to gateway-ws. **Do not connect to port 4500 directly in production** — the port mapping in `docker-compose.yml` is a temporary development convenience (marked TODO for removal).

| Step | Direction | Message |
|------|-----------|---------|
| 1 | Client → Server | TCP + WebSocket upgrade (no auth yet) |
| 2 | Client → Server | `{ "type": "auth", "payload": { "token": "<access_token>" } }` — must be sent within **5 seconds** of connecting |
| 3 | Server → Client | `{ "type": "connected", "payload": { "userId": "<id>" } }` — connection is now authenticated |

If authentication fails, the server closes the socket with one of these codes (application-reserved range per RFC 6455):

| Code | Reason |
|------|--------|
| `4001` | Unauthorized — token missing, invalid, expired, wrong type, or 5s timeout exceeded without sending an auth message |
| `4003` | Bad Request — first message is not valid JSON, or does not have the required `{ type, payload.token }` shape |

The `type` claim in the token is verified in addition to the signature — a refresh token is rejected even if the secret matches, as a defense against misconfiguration.

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
make up   # starts postgres + auth-service + user-service + gateway-api + gateway-ws + nginx
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
cp .env.example .env   # fill in JWT_SECRET — must match auth-service's value
npm install             # if not already done for unit tests
set -a && source .env && set +a
npm run dev              # ws://localhost:4500
```

> **If a Docker container for gateway-ws is already running** (e.g. from `make up`), it holds port 4500 on the host — stop it first or this fails with `EADDRINUSE`: `docker compose -p mypong stop gateway-ws`.
>
> **`set -a && source .env && set +a` only exports variables into that shell session.** If you open a new terminal to run gateway-ws again (not just to connect a client to it), repeat the `source .env` there too — otherwise Zod will reject the missing `PORT`/`JWT_SECRET` as `undefined`.
>
> Same shell-export risk as [auth-service](../auth-service/README.md#local-native-faster-iteration): sourcing `.env` here and then running `make up` in the same terminal can shadow the root `.env`. Open a new terminal for `make up`, or `unset PORT JWT_SECRET` first.

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