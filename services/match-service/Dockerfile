# Build context: repo root (needed to access tsconfig.base.json)

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app/services/match-service

COPY tsconfig.base.json /app/
COPY services/match-service/package.json services/match-service/package-lock.json ./
RUN npm ci

COPY services/match-service/tsconfig.json ./
COPY services/match-service/src/ ./src/
RUN npm run build

RUN npm ci --omit=dev

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/services/match-service/dist ./dist
COPY --from=builder /app/services/match-service/node_modules ./node_modules
COPY services/match-service/package.json ./
COPY services/match-service/migrations/ ./migrations/

USER node

EXPOSE 4502

CMD ["node", "dist/index.js"]
