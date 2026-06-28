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