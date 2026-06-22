# Build context: repo root (needed to access tsconfig.base.json)

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Mirror repo structure so "extends: ../../tsconfig.base.json" resolves correctly
WORKDIR /app/services/auth-service

# Build tools required to compile argon2 native bindings
RUN apk add --no-cache python3 make g++

# tsconfig.base.json at repo root — must be at /app/ to match the relative path
COPY tsconfig.base.json /app/

# Install all dependencies (dev + prod) for TypeScript compilation
COPY services/auth-service/package.json services/auth-service/package-lock.json ./
RUN npm ci

# Compile TypeScript
COPY services/auth-service/tsconfig.json ./
COPY services/auth-service/src/ ./src/
RUN npm run build

# Install production-only dependencies (argon2 native bindings compiled here)
RUN npm ci --omit=dev

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

# Flat structure — no TypeScript, no monorepo paths needed
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/services/auth-service/dist ./dist
COPY --from=builder /app/services/auth-service/node_modules ./node_modules
COPY services/auth-service/package.json ./
COPY services/auth-service/migrations/ ./migrations/
# Run as non-root (node user is built into node:alpine)
USER node

EXPOSE 4001

CMD ["node", "dist/index.js"]
