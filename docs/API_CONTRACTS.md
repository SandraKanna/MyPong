# MyPong — API Contracts

Request/response shape for each service's public API. Where a contract needs data a service doesn't have yet, it's filled with dummy data — noted inline, removed once the real service ships.

---

## auth-service

Base path: `/api/auth/*` (public, no JWT required).

### POST /api/auth/register

Request: `{ email: string, password: string }`
Response `201`: `{ userId: number, email: string }`

### POST /api/auth/login

Request: `{ email: string, password: string }`
Response `200`: `{ accessToken: string }`

Also sets the refresh token as an httpOnly cookie.

> auth-service never calls user-service. Profile data (username, avatar) is fetched separately via `GET /api/users/me` after login.

### POST /api/auth/refresh

No body; reads refresh token from cookie.
Response `200`: `{ accessToken: string }`. Rotates the refresh cookie.

### DELETE /api/auth/session (logout)

No body; reads refresh token from cookie to revoke it.
Response `204`, clears the refresh cookie.

---

## user-service

Base path: `/api/users/*` (JWT required — gateway-api validates the Bearer token and injects `x-user-id`; user-service never decodes JWTs directly).

### GET /api/users/me

No body.
Response `200`: `{ userId: number, username: string, avatar_url: string | null }`
Response `404`: `{ error: 'Profile not found' }` — no profile row exists yet; the row is created on the first successful PATCH.

### PATCH /api/users/me

Request: `{ username: string }` — min 1 char, max 30 chars, alphanumeric + hyphens + underscores only.
Response `200`: `{ userId: number, username: string, avatar_url: string | null }`
Response `400`: `{ error: 'Invalid input', details: { username: string[] } }` — Zod validation failure.
Response `409`: `{ error: 'Username already taken' }` — Postgres unique_violation on username column.

### POST /api/users/me/avatar

Multipart form upload. Field name: `file`. Do NOT set Content-Type manually — the browser/client must set it (including the boundary).

Validation: file content (magic bytes), not the client-supplied MIME type or filename.
Accepted types: JPEG, PNG, WebP, GIF.
Max file size: 5 MB. Exceeding this is caught by gateway-api's body limit before user-service is reached (or by @fastify/multipart at user-service if the gateway lets it through).
Processing: resized to max 512×512 (aspect ratio preserved), re-encoded as WebP. Re-encoding sanitises the file — the output is generated from the decoded bitmap, discarding any embedded metadata.
Storage: `{AVATARS_DIR}/{userId}.webp` — filename is the validated userId, never the client-supplied filename (closes path traversal). Overwrites the previous avatar; no delete step.

Response `200`: `{ userId: number, username: string, avatar_url: string | null }` — same shape as GET/PATCH /me. `avatar_url` will be `/avatars/{userId}.webp`.
Response `400`: `{ error: 'No file provided' }` — multipart request with no file part.
Response `400`: `{ error: 'Unsupported image type — accepted: JPEG, PNG, WebP, GIF' }` — magic byte check failed.
Response `401`: missing or invalid `x-user-id` header.
Response `413`: `{ error: 'File too large (max 5 MB)' }` — fileSize limit exceeded.
Response `422`: `{ error: 'Profile not found — set a username first' }` — no profile row exists (UPDATE affected 0 rows). Avatar upload requires a prior PATCH /me to create the profile row.

### GET /api/users/:id/stats

No body. `:id` must be a positive integer.
Response `200`: `{ userId: number, gamesPlayed: number, gamesWon: number, highestScore: number, winRate: number }` — `winRate` is `gamesWon / gamesPlayed` rounded to 4 decimal places (e.g. `0.6667`), or `0` if `gamesPlayed` is `0`. Returns zeroed defaults (all `0`) if the user has no recorded matches; never a `404`.
Response `400`: `{ error: 'Invalid user id' }` — `:id` is not a positive integer.
Response `401`: missing or invalid `x-user-id` header.

### GET /api/users/:id/matches

No body. `:id` must be a positive integer.
Query params: `limit` (default `20`, max `50`) and `offset` (default `0`) — both must be non-negative integers.
Response `200`: `{ userId: number, matches: MatchHistoryEntry[], limit: number, offset: number }` — results ordered by `playedAt` DESC.
`MatchHistoryEntry`: `{ matchId: number, opponentId: number, result: 'win'|'loss', myScore: number, oppScore: number, status: 'completed'|'forfeit', playedAt: string (ISO 8601) }` — `opponentId` is a raw user id; username resolution is the frontend's responsibility.
Response `400`: `{ error: 'Invalid user id' }` — `:id` is not a positive integer.
Response `400`: `{ error: 'limit must be a positive integer' }` — `limit` < 1 or non-numeric.
Response `400`: `{ error: 'limit must not exceed 50' }` — `limit` > 50.
Response `400`: `{ error: 'offset must be a non-negative integer' }` — `offset` < 0 or non-numeric.
Response `401`: missing or invalid `x-user-id` header.