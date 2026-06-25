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
Response `200`: `{ accessToken: string, user: { userId: number, email: string } }`

Also sets the refresh token as an httpOnly cookie.

> `user` is dummy data: a `dummy_user_profiles` table in auth-service, seeded with fake profiles, joined on login. Real source is `user-service` (Phase 2) — once it ships, this field comes from there instead and the dummy table is dropped.

### POST /api/auth/refresh

No body; reads refresh token from cookie.
Response `200`: `{ accessToken: string }`. Rotates the refresh cookie.

### DELETE /api/auth/session (logout)

No body; reads refresh token from cookie to revoke it.
Response `204`, clears the refresh cookie.