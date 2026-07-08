# nginx

Public edge: TLS termination, HTTP→HTTPS redirect, static SPA serving, avatar serving, and reverse proxying to gateway-api (REST) and gateway-ws (WebSocket). Not a standalone service — nginx is the final stage of the multi-stage `nginx/Dockerfile`, which first builds the frontend with Vite and then copies the output into an `nginx:alpine` image.

## How it's built

`nginx/Dockerfile` is a two-stage build with the build context set to the repo root:

1. **Builder stage**: installs frontend dependencies, runs `npm run build` → produces `dist/`
2. **Final stage**: starts from `nginx:alpine`, copies `dist/` into `/usr/share/nginx/html`, and bakes `nginx/nginx.conf` into `/etc/nginx/conf.d/default.conf`

`nginx.conf` is baked in via `COPY` (not a bind-mount) — what is built is what runs. The only bind-mount in production is `./nginx/certs:/etc/nginx/certs:ro` for the TLS certificates.

The `COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf` destination overwrites the base image's own `default.conf`, ensuring there is never a second server block competing on the same port.

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

### Smoke test

Requires the full stack running (`make up`) with migrations applied and the dev cert generated.

```bash
./nginx/scripts/smoke-test.sh                    # default: https://localhost
./nginx/scripts/smoke-test.sh https://localhost  # explicit URL
```

8 cases: HTTP→HTTPS redirect (301 status + Location header), SPA served at `/` (`div#root` present), register → login → refresh → logout through nginx end-to-end, and a refresh attempt after logout denied (not 200).

> Each run registers a new test user (email unique by PID) — these rows accumulate in the database and are not cleaned up automatically.
