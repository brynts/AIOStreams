FROM node:24-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder

# Tambah build tools untuk compile better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /build

# Copy package files dulu (caching lebih baik)
COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
COPY packages/core/package*.json ./packages/core/
COPY packages/frontend/package*.json ./packages/frontend/
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile --ignore-scripts

# Copy source code
COPY tsconfig.*json ./
COPY packages/server ./packages/server
COPY packages/core ./packages/core
COPY packages/frontend ./packages/frontend
COPY scripts ./scripts
COPY resources ./resources
COPY LICENSE ./

# Build
RUN pnpm run build

# === PERBAIKAN MEMORI & BETTER-SQLITE3 ===
RUN pnpm prune --prod
RUN pnpm rebuild better-sqlite3 --build-from-source


FROM base AS final
RUN apk add --no-cache curl

WORKDIR /app

# Copy hasil build
COPY --from=builder /build/package*.json /build/LICENSE ./
COPY --from=builder /build/pnpm-workspace.yaml ./
COPY --from=builder /build/pnpm-lock.yaml ./

COPY --from=builder /build/packages/core/package.*json ./packages/core/
COPY --from=builder /build/packages/frontend/package.*json ./packages/frontend/
COPY --from=builder /build/packages/server/package.*json ./packages/server/

COPY --from=builder /build/packages/core/dist ./packages/core/dist
COPY --from=builder /build/packages/frontend/out ./packages/frontend/out
COPY --from=builder /build/packages/server/dist ./packages/server/dist
COPY --from=builder /build/packages/server/src/static ./packages/server/dist/static

COPY --from=builder /build/resources ./resources

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /build/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /build/packages/frontend/node_modules ./packages/frontend/node_modules

# Healthcheck & Port (sesuaikan kalau perlu)
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:${PORT:-7860}/api/v1/status || exit 1

EXPOSE ${PORT:-7860}

ENTRYPOINT ["pnpm", "run", "start"]
