# nginx

Public edge: TLS termination, HTTP→HTTPS redirect, static SPA serving, avatar serving, and reverse proxying to gateway-api (REST) and gateway-ws (WebSocket). Not a standalone service — nginx is the final stage of the multi-stage `nginx/Dockerfile`, which first builds the frontend with Vite and then copies the output into an `nginx:alpine` image.

## How it's built

`nginx/Dockerfile` is a two-stage build with the build context set to the repo root:

1. **Builder stage**: installs frontend dependencies, runs `npm run build` → produces `dist/`

The builder stage's `WORKDIR` is `/app/frontend` — mirroring the frontend's real path in the repo — because `frontend/tsconfig.json` extends `../tsconfig.base.json` with a relative path; matching that directory depth inside the container is what makes the extend resolve. `tsconfig.base.json` itself is copied separately to `/app/` (one level above `WORKDIR`) for the same reason — get the depth wrong and the build fails on a missing base config, not an obviously-related error.

2. **Final stage**: starts from `nginx:alpine`, copies `dist/` into `/usr/share/nginx/html`, and bakes `nginx/nginx.conf` into `/etc/nginx/conf.d/default.conf`

`nginx.conf` is baked in via `COPY` (not a bind-mount) — what is built is what runs. The only bind-mount in production is `./nginx/certs:/etc/nginx/certs:ro` for the TLS certificates.

The `COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf` destination overwrites the base image's own `default.conf`, ensuring there is never a second server block competing on the same port.

## Client-side routing fallback

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

React Router handles routes like `/profile` or `/game` entirely in the browser — there's no `/profile` file on disk. Without this fallback, refreshing the page (or opening a direct link) on any route other than `/` would hit nginx looking for a matching file, find nothing, and return a `404` instead of serving the SPA. `try_files` checks for a real file or directory first, and falls back to `index.html` for everything else, letting React Router take over from there.

## TLS certificates (local dev)

nginx requires a TLS certificate to start. For local development, generate a self-signed cert from the repo root:

```bash
./scripts/generate-dev-cert.sh
```

This writes `nginx/certs/cert.pem` and `nginx/certs/key.pem` — a 2048-bit RSA cert for `CN=localhost` with `subjectAltName=DNS:localhost,IP:127.0.0.1`, valid for 365 days. The script is a no-op if the files already exist; use `--force` to regenerate.

`nginx/certs/` is gitignored — certs are never committed. `docker-compose.yml` bind-mounts the directory read-only: `./nginx/certs:/etc/nginx/certs:ro`.

Browsers will show a security warning for this self-signed cert. Accept it once per session, or configure your OS to trust it. `curl` requires `-k` / `--insecure`.

## Upstream resolver

`nginx.conf` uses a variable + `resolver 127.0.0.11` for the `/api/` and `/ws` proxy targets:

```nginx
resolver 127.0.0.11 valid=30s;

location /api/ {
    set $gateway_api http://gateway-api:4000;
    proxy_pass $gateway_api;
    ...
}
```

Using a variable in `proxy_pass` defers hostname resolution to request time rather than nginx startup. Without this, nginx would fail to start if `gateway-api` or `gateway-ws` wasn't already listening — `depends_on` in `docker-compose.yml` only guarantees container start order, not application readiness. `127.0.0.11` is Docker's internal DNS resolver.

`/api/` also sets the standard `X-Forwarded-*` headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`) so gateway-api sees the original client IP and protocol, not nginx's.

`/ws` uses the same resolver pattern but needs three things `/api/` doesn't:

```nginx
location /ws {
    set $gateway_ws http://gateway-ws:4500;
    proxy_pass          $gateway_ws;
    proxy_http_version  1.1;
    proxy_set_header    Upgrade    $http_upgrade;
    proxy_set_header    Connection "upgrade";
    proxy_read_timeout  3600s;
}
```

- `proxy_http_version 1.1` — nginx proxies at HTTP/1.0 by default, but the WS handshake requires 1.1.
- `Upgrade`/`Connection: upgrade` headers — without these, the connection never upgrades from HTTP to WebSocket; it stays a plain request.
- `proxy_read_timeout 3600s` — nginx's default read timeout is 60s, which would silently kill any game session or idle lobby connection that outlasts a minute. Raised well above any realistic session length.

## Avatar serving

User avatars are served directly from disk, not proxied to any service:

```nginx
location /avatars/ {
    alias /var/www/avatars/;
}
```

This is a filesystem alias into the `avatars_data` Docker volume — the same volume user-service writes into on upload — not a reverse proxy. There's no upstream service to resolve here, so this location doesn't use the `resolver`/variable `proxy_pass` mechanism described above at all; nginx reads the file straight off the mounted volume.

This path has no auth gate, and that's intentional rather than an oversight: avatar images are meant to be publicly loadable, the same as profile pictures in most apps, since an `<img src="...">` request from the browser never carries an `Authorization` header. Anyone who knows or guesses a filename can fetch that avatar, but nothing else — no profile data, no stats, no account info — is reachable through this path.

## Healthcheck

nginx's Docker healthcheck is:

```
test: ["CMD", "curl", "-kfsS", "https://127.0.0.1/", "-o", "/dev/null"]
```

This uses `curl`, not `wget` — every other HTTP-healthcheck service in this repo (auth-service, gateway-api, user-service, gateway-ws) uses `wget -qO- http://127.0.0.1:<port>/health`, but that doesn't work here. nginx's port-80 server block always responds with a `301` redirect to `https://`, and busybox `wget` follows redirects with no way to disable that behavior and no `--no-check-certificate` equivalent — so it can never get past the self-signed cert on the other end of the redirect. `curl` is already present in the `nginx:alpine` base image and supports `-k` to skip TLS verification, so it's used here instead: `-fsS` fails silently on HTTP errors while still printing them, and `-o /dev/null` discards the response body since only the exit code matters.

## Rebuilding after a frontend change

nginx serves the Vite build that was compiled *into its image*. Editing a `.tsx` file and reloading the browser does nothing — the image must be rebuilt:

```bash
docker compose -p mypong build --no-cache nginx
docker compose -p mypong up -d nginx
```

To confirm which build is actually being served (don't guess — grep the bundle):

```bash
docker compose -p mypong exec nginx sh -c "grep -r '<your_string>' /usr/share/nginx/html/assets/*.js"
```

Replace `<your_string>` with a short unique string you added to a component. No output means that build isn't in the image yet.

## Testing

No unit tests — nginx is static config plus a copied build artifact.

nginx's role as the sole TLS-terminating entry point is already demonstrated end-to-end by three other services' own Docker sections, since every one of those browser sessions passes through nginx to produce its screenshot: [auth-service's register flow](../services/auth-service/README.md#docker-full-compose-stack), [gateway-api's routing confirmation](../services/gateway-api/README.md#docker-full-compose-stack), and [gateway-ws's WS handshake](../services/gateway-ws/README.md#docker-full-compose-stack). There's no separate "Docker (full Compose stack)" section here for that reason — it would just repeat one of those three.

### Smoke test

Requires the full stack running (`make up`) with migrations applied and the dev cert generated.

```bash
./nginx/scripts/smoke-test.sh                    # default: https://localhost
./nginx/scripts/smoke-test.sh https://localhost  # explicit URL
```

8 cases: HTTP→HTTPS redirect (301 status + Location header), SPA served at `/` (`div#root` present), register → login → refresh → logout through nginx end-to-end, and a refresh attempt after logout denied (not 200).

> Each run registers a new test user (email unique by PID) — these rows accumulate in the database and are not cleaned up automatically.

## Gotchas / known limitations

- **`/avatars/` has no auth gate — this is intentional, not a gap.** See "Avatar serving" above: avatar images are served as public static files by design, since `<img src>` requests can't carry an `Authorization` header. Nothing beyond the image itself is exposed through this path.
