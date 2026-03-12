# Stage 1: Build
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Stage 2: Runtime with Litestream for SQLite backup
FROM oven/bun:1
WORKDIR /app

# Install Litestream for continuous SQLite replication to S3
RUN apt-get update && apt-get install -y wget && \
    wget -q https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.deb && \
    dpkg -i litestream-v0.3.13-linux-amd64.deb && \
    rm litestream-v0.3.13-linux-amd64.deb && \
    apt-get remove -y wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/db-schemas.ts ./
COPY --from=build /app/modules ./modules

# Litestream config (optional — runs without backup if LITESTREAM_* vars are unset)
COPY litestream.yml /etc/litestream.yml

ENV NODE_ENV=production
ENV DATABASE_PATH=/data/vobase.db

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Entrypoint: if LITESTREAM_REPLICA_URL is set, use Litestream to wrap the app;
# otherwise, run the app directly.
CMD if [ -n "$LITESTREAM_REPLICA_URL" ]; then \
      litestream replicate -exec "bun run dist/server.js" -config /etc/litestream.yml; \
    else \
      bun run dist/server.js; \
    fi
