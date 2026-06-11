FROM node:24-bookworm-slim AS base
<<<<<<< HEAD

=======
>>>>>>> 985d8aff (fix: allow better-sqlite3 native build)
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
<<<<<<< HEAD

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /build

=======
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /build
>>>>>>> 985d8aff (fix: allow better-sqlite3 native build)
COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
COPY packages/core/package*.json ./packages/core/
COPY packages/frontend/package*.json ./packages/frontend/
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
<<<<<<< HEAD

RUN pnpm install --frozen-lockfile --ignore-scripts

=======
RUN pnpm install --frozen-lockfile
>>>>>>> 985d8aff (fix: allow better-sqlite3 native build)
COPY tsconfig.*json ./
COPY packages/server ./packages/server
COPY packages/core ./packages/core
COPY packages/frontend ./packages/frontend
COPY scripts ./scripts
COPY resources ./resources
COPY LICENSE ./
<<<<<<< HEAD

RUN pnpm run build


FROM base AS final

RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /build/package*.json /build/LICENSE ./
COPY --from=builder /build/pnpm-workspace.yaml ./
COPY --from=builder /build/pnpm-lock.yaml ./

=======
RUN pnpm run build
RUN rm -rf node_modules packages/core/node_modules packages/server/node_modules packages/frontend/node_modules
RUN pnpm install --prod --frozen-lockfile

FROM base AS final
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /build/package*.json /build/LICENSE ./
COPY --from=builder /build/pnpm-workspace.yaml ./
COPY --from=builder /build/pnpm-lock.yaml ./
>>>>>>> 985d8aff (fix: allow better-sqlite3 native build)
COPY --from=builder /build/packages/core/package.*json ./packages/core/
COPY --from=builder /build/packages/frontend/package.*json ./packages/frontend/
COPY --from=builder /build/packages/server/package.*json ./packages/server/
COPY --from=builder /build/packages/core/dist ./packages/core/dist
COPY --from=builder /build/packages/frontend/out ./packages/frontend/out
COPY --from=builder /build/packages/server/dist ./packages/server/dist
COPY --from=builder /build/packages/server/src/static ./packages/server/dist/static
COPY --from=builder /build/resources ./resources
<<<<<<< HEAD

# === INI VERSI PALING PAKSA ===
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
RUN cd packages/core && pnpm rebuild better-sqlite3 --build-from-source

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:${PORT:-7860}/api/v1/status || exit 1

EXPOSE ${PORT:-7860}

=======
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /build/packages/server/node_modules ./packages/server/node_modules
COPY --from=builder /build/packages/frontend/node_modules ./packages/frontend/node_modules
RUN mkdir -p /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:${PORT:-7860}/api/v1/status || exit 1
EXPOSE ${PORT:-7860}
>>>>>>> 985d8aff (fix: allow better-sqlite3 native build)
ENTRYPOINT ["pnpm", "run", "start"]
