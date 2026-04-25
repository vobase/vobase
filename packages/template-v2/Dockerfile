# Stage 1: install + build frontend bundle
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .

# Vite build args — Railway/Docker pass these through; required for any
# VITE_* var that must be baked into the frontend bundle.
ARG VITE_PLATFORM_URL
ARG VITE_PLATFORM_TENANT_SLUG
ARG VITE_PLATFORM_TENANT_NAME
ARG VITE_PRODUCT_NAME
ARG VITE_VENDOR_NAME
ARG VITE_ALLOWED_EMAIL_DOMAINS
ENV VITE_PLATFORM_URL=$VITE_PLATFORM_URL
ENV VITE_PLATFORM_TENANT_SLUG=$VITE_PLATFORM_TENANT_SLUG
ENV VITE_PLATFORM_TENANT_NAME=$VITE_PLATFORM_TENANT_NAME
ENV VITE_PRODUCT_NAME=$VITE_PRODUCT_NAME
ENV VITE_VENDOR_NAME=$VITE_VENDOR_NAME
ENV VITE_ALLOWED_EMAIL_DOMAINS=$VITE_ALLOWED_EMAIL_DOMAINS

RUN bun run build

# Stage 2: runtime
FROM oven/bun:1
WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/vobase.config.ts ./
COPY --from=build /app/server ./server
COPY --from=build /app/modules ./modules
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/db ./db
COPY --from=build /app/lib ./lib
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "main.ts"]
