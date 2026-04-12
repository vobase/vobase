# Stage 1: Install, generate, and build frontend
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run scripts/generate.ts

# Railway injects env vars as build args — expose VITE_ vars for Vite build
ARG VITE_PLATFORM_URL
ARG VITE_PLATFORM_TENANT_SLUG
ARG VITE_PLATFORM_TENANT_NAME
ARG VITE_PRODUCT_NAME
ARG VITE_COMPANY_NAME
ARG VITE_ALLOWED_EMAIL_DOMAINS
ENV VITE_PLATFORM_URL=$VITE_PLATFORM_URL
ENV VITE_PLATFORM_TENANT_SLUG=$VITE_PLATFORM_TENANT_SLUG
ENV VITE_PLATFORM_TENANT_NAME=$VITE_PLATFORM_TENANT_NAME
ENV VITE_PRODUCT_NAME=$VITE_PRODUCT_NAME
ENV VITE_COMPANY_NAME=$VITE_COMPANY_NAME
ENV VITE_ALLOWED_EMAIL_DOMAINS=$VITE_ALLOWED_EMAIL_DOMAINS

RUN bunx vite build

# Stage 2: Runtime
FROM oven/bun:1
WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server.ts ./
COPY --from=build /app/vobase.config.ts ./
COPY --from=build /app/tsconfig.json ./
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/modules ./modules
COPY --from=build /app/lib ./lib
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["bun", "run", "server.ts"]
