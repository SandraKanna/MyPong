# Build context: repo root (needed to access tsconfig.base.json)

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

# Mirror repo structure so "extends: ../../tsconfig.base.json" resolves correctly
WORKDIR /app/services/user-service

# tsconfig.base.json at repo root — must be at /app/ to match the relative path
COPY tsconfig.base.json /app/

# Install all dependencies (dev + prod) for TypeScript compilation
COPY services/user-service/package.json services/user-service/package-lock.json ./
RUN npm ci

# Compile TypeScript
COPY services/user-service/tsconfig.json ./
COPY services/user-service/src/ ./src/
RUN npm run build

# Install production-only dependencies
RUN npm ci --omit=dev

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/services/user-service/dist ./dist
COPY --from=builder /app/services/user-service/node_modules ./node_modules
COPY services/user-service/package.json ./
COPY services/user-service/migrations/ ./migrations/

# Create the avatar storage directory and give the non-root user ownership BEFORE
# switching away from root. Docker named volumes are initialised from the image's
# directory contents the first time they are mounted — so the ownership set here
# propagates to a fresh avatars_data volume. Without this, Docker Engine creates
# the volume owned by root and the node process cannot write to it.
RUN mkdir -p /var/www/avatars && chown -R node:node /var/www/avatars

# Run as non-root (node user is built into node:alpine)
USER node

EXPOSE 4002

CMD ["node", "dist/index.js"]
