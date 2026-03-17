# Monorepo deployment — builds packages/template with workspace dependency on packages/core.
# For standalone project Dockerfile, see packages/template/Dockerfile.

# Stage 1: Install, generate, and build frontend
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/package.json
COPY packages/template/package.json packages/template/package.json
COPY packages/template/stubs packages/template/stubs
COPY packages/template/patches packages/template/patches
COPY packages/create-vobase/package.json packages/create-vobase/package.json
RUN bun install --frozen-lockfile

COPY packages/core/src packages/core/src
COPY packages/template packages/template

WORKDIR /app/packages/template
RUN bun run scripts/generate.ts
RUN bunx vite build

# Stage 2: Runtime
FROM oven/bun:1
WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/packages/template ./packages/template

ENV NODE_ENV=production
WORKDIR /app/packages/template

RUN mkdir -p /app/packages/template/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD bun run db:migrate && bun run server.ts
