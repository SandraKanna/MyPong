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

`typecheck` runs twice because the project has two tsconfigs with incompatible settings: `tsconfig.json` targets the browser bundle (ESNext modules, Bundler resolution, react-jsx), while `tsconfig.node.json` targets `vite.config.ts` which runs in Node. A single `tsc --noEmit` can only use one config at a time, so both must be run explicitly.

## Dev server proxy

When running `npm run dev`, Vite proxies these paths to the running backend (configured in `vite.config.ts`):

| Path | Target | Notes |
|------|--------|-------|
| `/api` | `http://localhost:4010` (gateway-api) | Set-Cookie passthrough is default Vite behavior |
| `/avatars` | `https://localhost` (nginx) | `secure: false` — accepts the self-signed dev cert; without this proxy, avatar images render broken (Vite returns HTML with 200 instead of the file) |
| `/ws` | `ws://localhost:4500` (gateway-ws) | `ws: true` — required to forward the HTTP→WS upgrade handshake |

Production uses the same relative paths (`fetch('/api/...')`, `new WebSocket('/ws')`) — nginx handles routing there. No absolute URLs with hardcoded ports anywhere in the source.

## Directory structure

```
src/
  features/
    auth/       Login, register pages, auth state (Zustand), token refresh bootstrap
    game/       Full game UI — see Game feature below
    home/       Home page (post-login landing)
    profile/    Profile page, avatar upload
  shared/
    api/        httpClient.ts — fetch wrapper with silent token refresh
    ws/         wsClient.ts (singleton WS + reconnect), wsMessages.ts (message types)
    components/ Navbar
    routes/     ProtectedRoute (redirects unauthenticated users)
  layouts/      AppLayout (authenticated shell), PublicLayout (login/register shell)
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

## Known limitations

The game UI uses a placeholder color palette. A design/styling pass is deferred to a later phase.
