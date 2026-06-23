# Build context: repo root (needed to access tsconfig.base.json)

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app/services/gateway-api

COPY tsconfig.base.json /app/
COPY services/gateway-api/package.json services/gateway-api/package-lock.json ./
RUN npm ci

COPY services/gateway-api/tsconfig.json ./
COPY services/gateway-api/src/ ./src/
RUN npm run build

RUN npm ci --omit=dev

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/services/gateway-api/dist ./dist
COPY --from=builder /app/services/gateway-api/node_modules ./node_modules
COPY services/gateway-api/package.json ./

USER node

EXPOSE 4000

CMD ["node", "dist/index.js"]
