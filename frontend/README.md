# frontend

React 19 + TypeScript + Vite single-page application. In production it is compiled to a static `dist/` directory and served by nginx (no Node process at runtime). The dev server proxies API and WebSocket traffic to the running backend stack.

## Scripts

```bash
npm run dev        # Vite dev server on http://localhost:3000 (with proxy — see below)
npm run build      # Production build → dist/ (consumed by nginx/Dockerfile)
npm test           # Vitest (jsdom environment, tests/ directory)
npm run lint       # ESLint over src/
npm run typecheck  # tsc -p tsconfig.json && tsc -p tsconfig.node.json (both tsconfigs)
```

`typecheck` invokes `tsc` twice because the project has two tsconfigs with incompatible settings: `tsconfig.json` targets the browser bundle (ESNext modules, Bundler resolution, react-jsx), while `tsconfig.node.json` targets `vite.config.ts` which runs in Node. A single `tsc` invocation can only use one config at a time, so both are chained with `&&` in the one script.

## Testing

### Unit tests

Independent of Docker and of any running backend — components and stores are tested with mocked API/WS calls, no live service needed.

```bash
cd frontend
npm install # if you don't already have node_modules
npm test
```

21 files and 220 tests should pass: state and client layers — `gameStore` (6-phase state machine: idle→queued→matched→playing→paused→ended, including guest and cold-start reconnect edge cases), `profileState` (username status tracking, `useMyDisplayName`), `httpClient` (single-flight token refresh, retry-with-new-token, auth-path skip, refresh failure), `wsClient` (auth-on-open, no-op when not connected, per-type dispatch, unsubscribe, reconnect backoff up to the 3s cap), `auth` (login/register), and `profile` (`readErrorMessage` field-level vs. top-level vs. default fallback across every profile/avatar/stats/matches/lookup call). Component tests cover the full game UI (`CountdownOverlay`, `GameBoard` keyboard input and rendering, `GamePage` phase-aware unmount cleanup, `LobbyView`, `PauseOverlay`, `ResultScreen`), auth pages (`LoginPage`, `RegisterPage`), routing guards (`ProtectedRoute`, `PublicOnlyRoute`), and profile/stats (`ProfilePage`, `StatsDisclosure`, `StatsSummary`, `MatchHistoryTable`, `Navbar`).

frontend has no Docker container or host-facing verification story of its own — nginx serves the compiled build. See [nginx's README](../nginx/README.md#testing) for the full build-and-serve verification, including its own smoke test covering the SPA being served correctly through the full auth flow.

## Dev server proxy

`npm run dev` starts Vite's dev server with hot module reload — use it for active frontend development instead of rebuilding the Docker image on every change. It only serves the frontend itself; the backend stack must already be running for anything beyond the static UI to work.

Vite proxies these paths to the running backend (configured in `vite.config.ts`):

| Path | Target | Notes |
|------|--------|-------|
| `/api` | `http://localhost:4010` (gateway-api) | Set-Cookie passthrough is default Vite behavior |
| `/avatars` | `https://localhost` (nginx) | `secure: false` — accepts the self-signed dev cert; without this proxy, avatar images render broken (Vite returns HTML with 200 instead of the file) |
| `/ws` | `ws://localhost:4500` (gateway-ws) | `ws: true` — required to forward the HTTP→WS upgrade handshake |

Production uses the same relative paths (`fetch('/api/...')`, `new WebSocket('/ws')`) — nginx handles routing there. No absolute URLs with hardcoded ports anywhere in the source.

**Setup (once per fresh environment):**

1. Make sure the full backend stack is up (`make up` from the repo root — see the [root README](../README.md#prerequisites)).
2. Uncomment `gateway-api`'s `127.0.0.1:4010:4000` and `gateway-ws`'s `127.0.0.1:4500:4500` port mappings in the root `docker-compose.yml` (both marked `# Native dev only`) — the dev server's `/api` and `/ws` proxies need them reachable from the host.
3. Recreate both containers so the change takes effect:

```bash
docker compose -p mypong up -d gateway-api
docker compose -p mypong up -d gateway-ws
```

4. Confirm both are up: `docker ps -a` should show `127.0.0.1:4010->4000/tcp` and `127.0.0.1:4500->4500/tcp`.

**Run:**

```bash
cd frontend
npm install   # if you don't already have node_modules
npm run dev   # http://localhost:3000
```

> **If the backend stack isn't running**, requests through the proxy fail with `ECONNREFUSED` in the Vite terminal (e.g. `http proxy error: /api/auth/refresh`) — the dev server itself starts fine, but every proxied call has nothing to reach. Start the backend stack, then reload the page.

**Verify manually:** 

Open `http://localhost:3000`, register or log in, and confirm the page loads correctly with no proxy errors in the terminal.

> **Session persistence is limited in this flow.** The refresh token cookie is set with the `Secure` flag (see [auth-service's README](../services/auth-service/README.md#gotchas)), so it never survives over plain `http://localhost:3000`. Login works and the access token stays valid in memory, but any action that triggers a token refresh (page bootstrap, background checks) gets a `401` on `/api/auth/refresh` and cascades to a logout within seconds. Workaround: set `NODE_ENV: development` in the root `docker-compose.yml` for auth-service (don't commit) to drop the `Secure` flag while doing native frontend dev — see auth-service's own native-dev flow for the same workaround.

> **Session drops right after login in dev mode.** React's StrictMode double-invokes effects on mount (mount→unmount→mount) as a deliberate dev-only check. This makes `useWsSession`'s connection effect register two WS sessions for the same user in quick succession — gateway-ws's single-session-per-user rule (see [gateway-ws's README](../services/gateway-ws/README.md#single-session-per-user)) then closes the first one with code `4009`, and the app reads that as "signed in elsewhere" even though nothing else was actually connected. Confirmed absent in the production build (`https://localhost` via nginx, no StrictMode double-invoke) — this is a `npm run dev`-only quirk, not a real session conflict. Not yet fixed at the code level (see CLAUDE.md pendientes).

**Cleanup:** 

Once you're done with `npm run dev`, re-comment both port mappings in the root `docker-compose.yml` and recreate the containers again so the change takes effect:

```bash
docker compose -p mypong up -d gateway-api
docker compose -p mypong up -d gateway-ws
```

> **Session persistence is limited in this flow.** The refresh token cookie is set with the `Secure` flag (see [auth-service's README](../services/auth-service/README.md#gotchas)), so it never survives over plain `http://localhost:3000`. Login works and the access token stays valid in memory, but any action that triggers a token refresh (page bootstrap, background checks) gets a `401` on `/api/auth/refresh` and cascades to a logout within seconds. Workaround: set `NODE_ENV: development` in the root `docker-compose.yml` for auth-service (don't commit) to drop the `Secure` flag while doing native frontend dev — see auth-service's own native-dev flow for the same workaround.

> **Session drops right after login in dev mode.** React's StrictMode double-invokes effects on mount (mount→unmount→mount) as a deliberate dev-only check. This makes `useWsSession`'s connection effect register two WS sessions for the same user in quick succession — gateway-ws's single-session-per-user rule (see [gateway-ws's README](../services/gateway-ws/README.md#single-session-per-user)) then closes the first one with code `4009`, and the app reads that as "signed in elsewhere" even though nothing else was actually connected. Confirmed absent in the production build (`https://localhost` via nginx, no StrictMode double-invoke) — this is a `npm run dev`-only quirk, not a real session conflict. Not yet fixed at the code level (see CLAUDE.md pendientes).

## Directory structure

```
  src/
    features/
      auth/       Login, register pages, auth state (Zustand), token refresh bootstrap
      game/       Full game UI — see Game feature below (includes its own hooks/)
      home/       Home page (post-login landing)
      profile/    Profile page, avatar upload, stats
    shared/
      api/        httpClient.ts — fetch wrapper with silent token refresh
      ws/         wsClient.ts (singleton WS + reconnect), wsMessages.ts (message types)
      components/ Navbar
      routes/     ProtectedRoute (redirects unauthenticated users), PublicOnlyRoute (redirects logged-in users away from login/register)
    layouts/      AppLayout (authenticated shell), PublicLayout (login/register shell)
    styles/       index.css — Tailwind entry point (@theme tokens, no separate config file)
    main.tsx      Entry point — React root, router
```

Features are self-contained: each owns its pages, API calls, and local state. `shared/` holds what crosses feature boundaries.

## Game feature

The game UI is driven by a 6-phase Zustand state machine in `features/game/state/gameStore.ts`:

| Phase | Description |
|-------|-------------|
| `idle` | Not in a game — shows lobby with "Find Match" button |
| `queued` | Waiting for an opponent — shows lobby with "Cancel" button |
| `matched` | Opponent found — shows 3-second visual countdown |
| `playing` | Match in progress — shows live game board |
| `paused` | Opponent disconnected — shows game board with pause overlay |
| `ended` | Match over — shows result screen with score and reason |

The WS singleton (`shared/ws/wsClient.ts`) auto-reconnects with exponential backoff (500ms initial, 3s cap) — fast enough to beat game-service's 5-second disconnect grace window. `disconnectWs()` suppresses the reconnect loop (intentional logout/leave, not a crash).

Physics constants (paddle speed, ball speed, board dimensions) are duplicated by hand from `services/game-service/src/physicsConfig.ts` into `features/game/components/GameBoard.tsx`. There is no shared package — if a physics constant changes in game-service, `GameBoard.tsx` must be updated manually.

## STUDY: comments

Some files carry inline comments prefixed `STUDY:`. These are temporary learning scaffolding for a backend engineer working through React and frontend patterns for the first time — they explain the *why* in plain language (what a hook does, why StrictMode mounts twice, why the singleton pattern, etc.). They are not permanent documentation and will be removed in a future cleanup pass. They can be located with `grep -r 'STUDY:' src/`.
