# MyPong — API Contracts

Request/response shape for each service's REST API. This is an internal reference for backend/frontend contract coordination during development — not a public API for third-party integration (the auth model assumes a same-origin frontend; there's no CORS, API key scheme, or rate limiting for external callers). Where a contract needed data a service didn't have yet, it was filled with dummy data — noted inline, removed once the real service shipped.

This document covers REST only. The game feature (matchmaking, real-time session lifecycle, physics frames, pause/reconnect, forfeit) runs entirely over WebSocket — see the [gateway-ws](services/gateway-ws/README.md), [game-service](services/game-service/README.md), and [match-service](services/match-service/README.md) READMEs for those message contracts.

## Design conventions

- Resources, not verbs, in URLs (`/api/users/:id/stats`, not `/api/getUserStats`)
- HTTP verbs carry real semantic meaning: `GET` for reads, `POST` for creation/upload, `PATCH` for partial updates, `DELETE` for revocation
- Status codes communicate outcome precisely: `201` on creation, `204` on a successful no-body response, `409` on conflict, `413` on payload too large, `422` on a missing precondition — not a blanket `200`/`400` for everything
- Stateless: identity travels in the JWT on every request (injected as `x-user-id` by gateway-api); no server-side session state between calls

---

## auth-service

Base path: `/api/auth/*` (public, no JWT required).

### POST /api/auth/register

Request: `{ email: string, password: string }` — password must be at least 8 characters.
Response `201`: `{ userId: number, email: string }`
Response `400`: `{ error: 'Invalid input', details: { email?: string[], password?: string[] } }` — Zod validation failure (malformed email, password under 8 chars, missing fields).
Response `409`: `{ error: 'Email already registered' }`

### POST /api/auth/login

Request: `{ email: string, password: string }`
Response `200`: `{ accessToken: string }`
Response `400`: `{ error: 'Invalid input', details: { email?: string[], password?: string[] } }` — Zod validation failure.
Response `401`: `{ error: 'Invalid credentials' }` — same message for wrong email and wrong password; prevents user enumeration.

Also sets the refresh token as an httpOnly cookie.

> auth-service never calls user-service. Profile data (username, avatar) is fetched separately via `GET /api/users/me` after login.

### POST /api/auth/refresh

No body; reads refresh token from cookie.
Response `200`: `{ accessToken: string }`. Rotates the refresh cookie.
Response `401`: missing cookie, invalid/expired token, and already-revoked token all return the same status with a generic message — the client cannot distinguish which case fired, by design.

### POST /api/auth/guest

No body required.
Response `200`: `{ accessToken: string }` — same shape as login's response.

Token payload: `{ sub: "<negative integer>", type: "guest", exp: <now + 15 minutes> }`, signed with `JWT_SECRET`. The `sub` value is a randomly generated negative integer — guaranteed collision-free with real user IDs (Postgres serials start at 1, always positive) and with `AI_BOT_USER_ID` (exactly `0`). No refresh token, no `Set-Cookie` header, no DB write of any kind.

A guest token is accepted by gateway-ws for opening a WebSocket connection (for PvE play). It is rejected by gateway-api's JWT middleware on every REST endpoint — a guest cannot call any authenticated REST route.

### DELETE /api/auth/session (logout)

No body; reads refresh token from cookie to revoke it if present.
Response `204`, clears the refresh cookie.

This endpoint is intentionally idempotent: it always returns `204` regardless of whether a valid cookie was present — if the cookie is missing, already expired, or already revoked, the response is still `204`. It never errors.

---

## user-service

Base path: `/api/users/*` (JWT required — gateway-api validates the Bearer token and injects `x-user-id`; user-service never decodes JWTs directly).

**Auth guard**: all five endpoints below return `401 { error: 'Missing or invalid user identity' }` if the `x-user-id` header is absent or non-numeric. This is not repeated per-endpoint.

### GET /api/users/me

No body.
Response `200`: `{ userId: number, username: string | null, avatar_url: string | null }`
Response `404`: `{ error: 'Profile not found' }` — no profile row exists yet; the row is created on the first successful PATCH.

### PATCH /api/users/me

Request: `{ username: string }` — min 1 char, max 30 chars, alphanumeric + hyphens + underscores only.
Response `200`: `{ userId: number, username: string | null, avatar_url: string | null }`
Response `400`: `{ error: 'Invalid input', details: { username: string[] } }` — Zod validation failure.
Response `409`: `{ error: 'Username already taken' }` — Postgres unique_violation on username column.

### POST /api/users/me/avatar

Multipart form upload. Do NOT set Content-Type manually — the browser/client must set it (including the boundary). The field name is not validated; `request.file()` accepts the first file part in the request regardless of its field name.

Validation: file content (magic bytes), not the client-supplied MIME type or filename.
Accepted types: JPEG, PNG, WebP, GIF.
Max file size: 5 MB. Exceeding this is caught by gateway-api's body limit before user-service is reached (or by @fastify/multipart at user-service if the gateway lets it through).
Processing: resized to max 512×512 (aspect ratio preserved), re-encoded as WebP. Re-encoding sanitises the file — the output is generated from the decoded bitmap, discarding any embedded metadata.
Storage: `{AVATARS_DIR}/{userId}.webp` — filename is the validated userId, never the client-supplied filename (closes path traversal). Overwrites the previous avatar; no delete step.

Response `200`: `{ userId: number, username: string | null, avatar_url: string | null }` — same shape as GET/PATCH /me. `avatar_url` will be `/avatars/{userId}.webp`.
Response `400`: `{ error: 'No file provided' }` — multipart request with no file part.
Response `400`: `{ error: 'Unsupported image type — accepted: JPEG, PNG, WebP, GIF' }` — magic byte check failed.
Response `413`: `{ error: 'File too large (max 5 MB)' }` — fileSize limit exceeded.
Response `422`: `{ error: 'Profile not found — set a username first' }` — no profile row exists (UPDATE affected 0 rows). Avatar upload requires a prior PATCH /me to create the profile row.

### GET /api/users/:id/stats

No body. `:id` must be a positive integer.
Response `200`: `{ userId: number, gamesPlayed: number, gamesWon: number, highestScore: number, winRate: number }` — `winRate` is `gamesWon / gamesPlayed` rounded to 4 decimal places (e.g. `0.6667`), or `0` if `gamesPlayed` is `0`. Returns zeroed defaults (all `0`) if the user has no recorded matches; never a `404`.
Response `400`: `{ error: 'Invalid user id' }` — `:id` is not a positive integer.

### GET /api/users/:id/matches

No body. `:id` must be a positive integer.
Query params: `limit` (default `20`, max `50`) and `offset` (default `0`) — both must be non-negative integers.
Response `200`: `{ userId: number, matches: MatchHistoryEntry[], limit: number, offset: number }` — results ordered by `playedAt` DESC.
`MatchHistoryEntry`: `{ matchId: number, opponentId: number, result: 'win'|'loss', myScore: number, oppScore: number, status: 'completed'|'forfeit', playedAt: string (ISO 8601) }` — `opponentId` is a raw user id; username resolution is the frontend's responsibility. The `status` field is returned as a raw string from the DB column; the only values ever written by match-service's `closeMatch()` are `'completed'` and `'forfeit'`, but there is no runtime validation enforcing the union on read.
Response `400`: `{ error: 'Invalid user id' }` — `:id` is not a positive integer.
Response `400`: `{ error: 'limit must be a positive integer' }` — `limit` < 1 or non-numeric.
Response `400`: `{ error: 'limit must not exceed 50' }` — `limit` > 50.
Response `400`: `{ error: 'offset must be a non-negative integer' }` — `offset` < 0 or non-numeric.
