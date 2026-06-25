# MyPong — Architecture Overview

MyPong is a microservices system organized around an API Gateway. Services are grouped into four trust boundaries — Public Edge, Gateways, Backend Services, and Data — enforced by two Docker networks, frontend-net and backend-net. Only the gateways sit on both networks; everything behind them is unreachable from the public internet.

---

## Public Edge

### nginx

Nginx is the only process exposed to the outside world. Terminates HTTPS and routes traffic: static frontend build, /api/* to gateway-api, /ws to gateway-ws. Also serves user avatars directly from a shared volume. No authentication, no business logic — routing and TLS only. Sits on frontend-net only. 

### frontend

The frontend is a React single-page application (SPA) running in the browser after the initial HTML/JS/CSS load. 
It talks to the backend only through /`api/*` (REST) or `/ws` (WebSocket) — never directly to an internal service. In production, nginx serves the compiled static build; the dev server is local-only.

---

## Gateways

### gateway-api

Sole entry point for REST calls. Validates the JWT access token on every request and rejects unauthenticated ones with 401, except for the public auth routes. No business logic, no database access — it only knows whether a token is valid and where to forward the request. Reaches auth-service and user-service. Sits on both networks.

### gateway-ws

Hub for all WebSocket traffic. The browser connects through nginx at `/ws`. game-service, matchmaking-service, tournament-service, and ia-bot-service each connect to it as clients rather than exposing their own ports. It routes messages both directions between browser and backend services. Holds `JWT_SECRET`, so it's expected to authenticate WebSocket connections the same way gateway-api authenticates REST ones. Sits on both networks.

---

## Backend Services

### auth-service

Owns the full credential lifecycle: registration, login, issuing access and refresh tokens, rotating and revoking them. It's the only service that touches password hashes or knows JWT_REFRESH_SECRET. gateway-api only holds JWT_SECRET, so it can verify access tokens but never issue or inspect refresh tokens. Backend-net only, called by gateway-api over HTTP.

### user-service

Owns public profile data: display name, stats, avatar. Writes to the avatars_data volume (nginx only reads from it). Never touches passwords or tokens, never queries auth-service's tables directly (it calls auth-service's API if it needs anything from there).

### game-service

Owns the physics and lifecycle of a single match: ball, paddles, goals, end conditions. Connects to gateway-ws as a client, receives input, pushes state updates. The match state lives in memory while the match is in progress, not persisted, so no need for a database. Completed results are meant to land in a matches table eventually. How it receives match assignments from matchmaking-service isn't modeled yet, but it's expected to happen through gateway-ws messages, not direct service calls.

### matchmaking-service

Pairs waiting players and starts a match. Connects to gateway-ws as a client to receive join/cancel requests and announce a pairing. Has DATABASE_URL — queue state needs to survive a restart. How it hands a new pairing off to game-service isn't modeled yet; expected to go through gateway-ws, same as above.

### tournament-service

tournament-service is intended to manage the structure and state of a tournament: creating brackets, advancing players through rounds, and determining a winner. It connects to gateway-ws to send and receive tournament events, has DATABASE_URL to persist brackets and results across a tournament's lifetime.

### ia-bot-service

AI opponent for guest play or solo matches. Connects to gateway-ws like the other game-domain services. No DATABASE_URL — guest sessions are deliberately ephemeral, in memory only, gone when the connection closes.

---

## Data

### postgres

Postgres is the single database instance for the entire system, (postgres:16-alpine, persisted via the postgres_data volume). Backend-net only — never reachable from the frontend or the public internet, only from services that hold DATABASE_URL (from .env). The intended rule is one table, one owning service: anyone else who needs that data calls the owner's API instead of querying its tables.