# Build context: repo root (needed to access tsconfig.base.json)

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app/services/gateway-ws

COPY tsconfig.base.json /app/
COPY services/gateway-ws/package.json services/gateway-ws/package-lock.json ./
RUN npm ci

COPY services/gateway-ws/tsconfig.json ./
COPY services/gateway-ws/src/ ./src/
RUN npm run build

RUN npm ci --omit=dev

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/services/gateway-ws/dist ./dist
COPY --from=builder /app/services/gateway-ws/node_modules ./node_modules
COPY services/gateway-ws/package.json ./

USER node

EXPOSE 4500

CMD ["node", "dist/index.js"]
