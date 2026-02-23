# -----------------------------------------------------------
# Multi-target Dockerfile for CoPI
#
# Targets:
#   app    — production Next.js server  (default)
#   worker — background job processor
#
# Build:
#   docker build --target app    -t copi-app .
#   docker build --target worker -t copi-worker .
# -----------------------------------------------------------

# ---- base ----
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---- deps: install production + dev dependencies ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: generate Prisma client and build Next.js ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ===========================================================
# TARGET: app — minimal production Next.js standalone server
# ===========================================================
FROM base AS app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Static assets produced by the build
COPY --from=builder /app/public ./public

# Standalone server and its bundled dependencies
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]

# ===========================================================
# TARGET: worker — background job processor
# ===========================================================
FROM base AS worker

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 worker

WORKDIR /app

# Install all dependencies (tsx needed for TypeScript execution)
COPY package.json package-lock.json ./
RUN npm ci

# Prisma schema + generate client
COPY prisma ./prisma
RUN npx prisma generate

# Application source code
COPY src ./src
COPY tsconfig.json ./

# Prompts used by LLM services
COPY prompts ./prompts

USER worker

CMD ["npx", "tsx", "src/worker/index.ts"]
