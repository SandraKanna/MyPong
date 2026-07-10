FROM node:24-alpine AS builder
WORKDIR /app/services/ai-bot-service

COPY services/ai-bot-service/package*.json ./
RUN npm ci

COPY shared/types/ /app/shared/types/
COPY tsconfig.base.json /app/tsconfig.base.json
COPY services/ai-bot-service/ ./

RUN npm run build

# ── Runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine
WORKDIR /app

RUN mkdir -p /tmp && chown -R node:node /tmp

COPY --from=builder /app/services/ai-bot-service/dist/ ./dist/
COPY --from=builder /app/services/ai-bot-service/node_modules/ ./node_modules/

USER node

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD test -f /tmp/healthy || exit 1

CMD ["node", "dist/index.js"]
