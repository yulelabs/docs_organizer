# Docs Organizer API (+ bundled web UI) — Railway / Docker
# Build context must be the monorepo root.

FROM node:22-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --workspace=@docs-organizer/api --workspace=@docs-organizer/web --workspace=@docs-organizer/shared --include-workspace-root

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY apps/web apps/web

# Empty VITE_API_BASE => same-origin /api calls when UI is served by the API
ENV VITE_API_BASE=
RUN npm run build -w @docs-organizer/shared \
 && npm run build -w @docs-organizer/api \
 && npm run build -w @docs-organizer/web

FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-por \
    tesseract-ocr-eng \
    poppler-utils \
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN npm ci --omit=dev --workspace=@docs-organizer/api --workspace=@docs-organizer/shared --include-workspace-root

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p /app/data/uploads /app/data/ocr-tmp

WORKDIR /app/apps/api

EXPOSE 3000

CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
