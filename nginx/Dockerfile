# Build context: repo root (frontend/tsconfig.json extends ../tsconfig.base.json)

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# Mirror repo structure so "../tsconfig.base.json" resolves correctly at build time
WORKDIR /app/frontend

# Manifests first — npm ci layer is cached independently from source changes
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# tsconfig.base.json at repo root — must be at /app/ to match the relative extends path
COPY tsconfig.base.json /app/

# Build config and source
COPY frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/src ./src/

# Produces /app/frontend/dist/
RUN npm run build

# ── Final image ───────────────────────────────────────────────────────────────
FROM nginx:alpine

# Vite production build — nginx.conf serves static files from this path
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# nginx config baked into the image.
# NOTE: docker-compose.yml currently bind-mounts ./nginx:/etc/nginx/conf.d:ro,
# which shadows this COPY at runtime and places certs at the wrong path for TLS.
# Resolve both the mount and the certs path in the compose update (next step).
COPY nginx/nginx.conf /etc/nginx/conf.d/nginx.conf

EXPOSE 80 443

# Default CMD from nginx:alpine: nginx -g 'daemon off;'
