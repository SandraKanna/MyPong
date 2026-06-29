# Build context: repo root (needed to access tsconfig.base.json)

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app/services/game-service

COPY tsconfig.base.json /app/
COPY services/game-service/package.json services/game-service/package-lock.json ./
RUN npm ci

COPY services/game-service/tsconfig.json ./
COPY services/game-service/src/ ./src/
RUN npm run build

RUN npm ci --omit=dev

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/services/game-service/dist ./dist
COPY --from=builder /app/services/game-service/node_modules ./node_modules
COPY services/game-service/package.json ./
COPY services/game-service/migrations/ ./migrations/

USER node

EXPOSE 4501

CMD ["node", "dist/index.js"]
