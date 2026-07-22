# Docs Organizer

Online invoice and receipt organizer with OCR.

Drop PDFs or photos, extract text (Portuguese + English), parse vendor / date / totals / IVA, and rename files into a tidy archive path:

```text
2024/03/supermarket/2024-03-15_continente_EUR42.90.pdf
```

**Live**

| Surface | URL |
| --- | --- |
| Frontend | https://docs-organizer.pages.dev |
| API + OCR | https://docs-organizer-api-production.up.railway.app |
| Health | https://docs-organizer-api-production.up.railway.app/api/health |

No authentication yet (planned later).

---

## Table of contents

1. [Architecture](#architecture)
2. [Tech stack](#tech-stack)
3. [Repository layout](#repository-layout)
4. [Services & keys](#services--keys)
5. [Run locally](#run-locally)
6. [Deploy](#deploy)
7. [API overview](#api-overview)
8. [Useful scripts](#useful-scripts)

---

## Architecture

```text
┌─────────────────────┐         ┌──────────────────────────────┐
│  React UI           │  HTTPS  │  Node.js API + OCR worker    │
│  (Cloudflare Pages) │ ──────► │  (Railway, Docker)           │
└─────────────────────┘         │                              │
                                │  • Express routes            │
                                │  • pg-boss job queue         │
                                │  • Tesseract / Poppler       │
                                └──────────────┬───────────────┘
                                               │
                         ┌─────────────────────┼─────────────────────┐
                         ▼                     ▼                     ▼
                  ┌─────────────┐      ┌──────────────┐      ┌─────────────┐
                  │ Neon        │      │ Local disk   │      │ Cloudflare  │
                  │ Postgres    │      │ or R2 bucket │      │ R2 (opt.)   │
                  └─────────────┘      └──────────────┘      └─────────────┘
```

### Request flow

1. Browser uploads a file (local API multipart, or signed URL → R2).
2. UI calls `POST /api/ocr-jobs` with the document id.
3. API enqueues a **pg-boss** job and returns immediately.
4. Worker downloads the file, converts PDF pages with **pdftoppm**, runs **Tesseract** (`por+eng`), parses fields, stores results in Postgres.
5. UI polls `GET /api/ocr-jobs/:id` until complete, then shows editable fields and an organized path.

### Why this stack

| Concern | Choice | Reason |
| --- | --- | --- |
| OCR compute | Railway Docker | Needs native binaries (`tesseract`, `poppler`, `imagemagick`); Workers are a poor fit |
| Frontend hosting | Cloudflare Pages | Free static hosting + CDN |
| Database | Neon Postgres | Serverless Postgres, free tier, works with pg-boss |
| Object storage | Local disk or R2 | Local for hobby; R2 for durable production files |
| Jobs | pg-boss | Postgres-backed queue — no Redis required |

---

## Tech stack

### Languages

- **TypeScript** everywhere (API, web, shared types)
- **SQL** for schema / migrations
- Shell helpers for provision scripts

### Frontend (`apps/web`)

| Library | Role |
| --- | --- |
| React 19 | UI |
| Vite 6 | Dev server + production build |
| TypeScript | Typing |

No UI framework/CSS library — custom CSS with Fraunces + Figtree fonts.

### Backend (`apps/api`)

| Library | Role |
| --- | --- |
| Node.js 22 | Runtime |
| Express 5 | HTTP API |
| `pg` | Postgres client |
| pg-boss | Background OCR jobs |
| Zod | Request validation |
| Multer | Local multipart uploads |
| `@aws-sdk/client-s3` + presigner | Cloudflare R2 (S3-compatible) uploads |
| `dotenv` | Local env loading |

### Native OCR tools (inside Docker / local OS)

| Binary | Role |
| --- | --- |
| `tesseract` (+ `por` / `eng` langs) | OCR |
| `pdftoppm` (poppler-utils) | PDF → PNG pages |
| `convert` (ImageMagick) | Optional image preprocess |

### Infra / deploy

| Tool | Role |
| --- | --- |
| Docker / `apps/api/Dockerfile` | Production API image with OCR packages |
| docker-compose | Local Postgres (+ optional API container) |
| Railway | Host API + OCR worker |
| Neon | Hosted Postgres |
| Cloudflare Pages | Host React build |
| Cloudflare R2 (optional) | File storage |
| GitHub Actions | CI + deploy workflows |
| Wrangler | Pages deploy CLI |

---

## Repository layout

```text
docs_organizer/
├── apps/
│   ├── api/                 # Express OCR API + worker
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── server.ts
│   │       ├── routes/
│   │       ├── services/    # ocr, parser, storage, jobs
│   │       └── db/
│   └── web/                 # React + Vite UI
├── packages/shared/         # Shared TS types
├── scripts/
│   └── provision-and-deploy.sh
├── .github/workflows/
│   ├── ci.yml
│   └── deploy.yml
├── docker-compose.yml
├── railway.toml
├── .env.example
└── docs/DEPLOY.md
```

npm workspaces monorepo:

- `@docs-organizer/api`
- `@docs-organizer/web`
- `@docs-organizer/shared`

---

## Services & keys

You only need **all cloud keys for production**. Locally you can run with Docker Postgres + local disk (no Neon / Railway / Cloudflare required).

### Summary

| Service | Required for | What you need |
| --- | --- | --- |
| Postgres | Local + prod | Local Compose **or** Neon `DATABASE_URL` |
| Railway | Production API | Project/account token + service env vars |
| Cloudflare Pages | Production UI | Account ID + API token (Pages Edit) |
| Cloudflare R2 | Optional durable files | R2 access keys + bucket |

---

### 1. Neon (Postgres) — production

1. Create an account at [https://console.neon.tech](https://console.neon.tech) (GitHub login works).
2. **New Project** → pick a region close to Railway (e.g. `us-east-1` or `eu-central-1`).
3. Open **Connection details** → copy the connection string (prefer the **pooled** URL for the app).

Example shape:

```text
postgresql://neondb_owner:PASSWORD@ep-xxxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
```

Use as:

- Local `.env` → `DATABASE_URL=...` (optional; Compose Postgres is fine for local)
- Railway variable → `DATABASE_URL`
- GitHub Actions secret → `DATABASE_URL`

> Tip: if Node/`pg` misbehaves with `channel_binding=require`, remove that query param and keep `sslmode=require`.

---

### 2. Railway (API + OCR) — production

1. Sign in at [https://railway.app](https://railway.app) with GitHub.
2. **New Project** → empty service (or deploy from this GitHub repo).
3. Set the service to build with Docker:
   - Dockerfile path: `apps/api/Dockerfile`
   - Build context: repository root  
   (also encoded in `railway.toml`)
4. Create a **project token**: Project Settings → Tokens → generate.  
   Save as `RAILWAY_TOKEN` (GitHub secret / CI).
5. Set service variables (see [Railway env vars](#railway-environment-variables)).
6. Generate a public domain: Railway service → Settings → Networking → generate domain  
   Example: `https://docs-organizer-api-production.up.railway.app`

CLI alternative (after `railway login`):

```bash
railway up --service docs-organizer-api --ci --detach
```

---

### 3. Cloudflare Pages (frontend) — production

1. Sign in at [https://dash.cloudflare.com](https://dash.cloudflare.com).
2. Copy **Account ID** (overview sidebar) → `CLOUDFLARE_ACCOUNT_ID`.
3. Create an API token: **My Profile → API Tokens → Create Token**  
   Custom token permissions:
   - Account → **Cloudflare Pages** → **Edit**
   - Account → **Account Settings** → **Read**
4. Save token as `CLOUDFLARE_API_TOKEN`.
5. Deploy with Wrangler (see [Deploy](#deploy)) to project name `docs-organizer`  
   → `https://docs-organizer.pages.dev`

Build env for the frontend:

```bash
VITE_API_BASE=https://YOUR-RAILWAY-API.up.railway.app
```

If `VITE_API_BASE` is empty, the UI calls same-origin `/api` (useful when the API also serves the built UI from Railway).

---

### 4. Cloudflare R2 (optional file storage)

Default production mode can use **local disk on Railway** (`STORAGE_DRIVER=local`). Files are lost on redeploy unless you attach a volume. For durable storage:

1. Cloudflare dashboard → **R2** → Create bucket (e.g. `docs-organizer`).
2. **Manage R2 API Tokens** → Create API token with Object Read & Write.
3. Set:

```env
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key>
R2_SECRET_ACCESS_KEY=<r2-secret>
R2_BUCKET=docs-organizer
```

---

### Environment variable reference

#### API (`.env` / Railway)

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string |
| `PORT` | No | Default `3000` |
| `NODE_ENV` | No | `development` / `production` |
| `CORS_ORIGIN` | Yes (prod) | Comma-separated allowed origins (Pages URL). Use `*` only for quick tests |
| `STORAGE_DRIVER` | No | `local` (default) or `r2` |
| `LOCAL_STORAGE_DIR` | No | Default `./data/uploads` |
| `OCR_LANG` | No | Default `por+eng` |
| `OCR_TMP_DIR` | No | Temp OCR working dir |
| `R2_*` | If `r2` | See above |

#### Web (build-time)

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_API_BASE` | Prod Pages | Absolute API origin, no trailing slash |

#### Railway environment variables

Minimum production set:

```env
DATABASE_URL=postgresql://...
NODE_ENV=production
PORT=3000
STORAGE_DRIVER=local
OCR_LANG=por+eng
LOCAL_STORAGE_DIR=/app/data/uploads
OCR_TMP_DIR=/app/data/ocr-tmp
CORS_ORIGIN=https://docs-organizer.pages.dev
```

---

## Run locally

### Prerequisites

- Node.js **22+**
- npm 10+
- Docker (for Postgres), **or** any local Postgres 16+
- OCR tools if you run the API outside Docker:

```bash
# Debian / Ubuntu
sudo apt-get install -y \
  tesseract-ocr tesseract-ocr-por tesseract-ocr-eng \
  poppler-utils imagemagick
```

### 1. Install

```bash
git clone https://github.com/yulelabs/docs_organizer.git
cd docs_organizer
cp .env.example .env
npm install
```

### 2. Start Postgres

```bash
docker compose up -d postgres
npm run db:migrate
```

Default local URL (already in `.env.example`):

```env
DATABASE_URL=postgresql://docs:docs@localhost:5432/docs_organizer
CORS_ORIGIN=http://localhost:5173
STORAGE_DRIVER=local
```

### 3. Run API + UI

In two terminals:

```bash
npm run dev:api
npm run dev:web
```

- UI: http://localhost:5173  
- API: http://localhost:3000  
- Health: http://localhost:3000/api/health  

Vite proxies `/api` to the API in development.

### Alternative: API in Docker

OCR packages are baked into `apps/api/Dockerfile`:

```bash
docker compose up --build api
```

### Verify

```bash
npm test          # invoice field parser unit tests
npm run typecheck
npm run build
```

---

## Deploy

### Production map

| Layer | Service | Artifact |
| --- | --- | --- |
| UI | Cloudflare Pages | `apps/web/dist` |
| API + OCR worker | Railway | Docker image from `apps/api/Dockerfile` |
| Database | Neon | Postgres + schema migration on boot |
| Files | Railway disk or R2 | uploads |

### Option A — manual (CLIs)

```bash
# Auth once
neonctl auth          # or paste DATABASE_URL
railway login
wrangler login

# Deploy everything
chmod +x scripts/provision-and-deploy.sh
./scripts/provision-and-deploy.sh
```

Or step by step:

```bash
# 1) Ensure Neon DATABASE_URL is set on Railway
railway variable set DATABASE_URL="postgresql://..." --service docs-organizer-api

# 2) Deploy API
railway up --service docs-organizer-api --ci --detach

# 3) Build + deploy Pages
export VITE_API_BASE="https://YOUR-API.up.railway.app"
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."
npm ci
npm run build -w @docs-organizer/shared
npm run build -w @docs-organizer/web
npx wrangler pages project create docs-organizer --production-branch=main || true
npx wrangler pages deploy apps/web/dist --project-name=docs-organizer --branch=main

# 4) Point API CORS at Pages
railway variable set CORS_ORIGIN="https://docs-organizer.pages.dev" --service docs-organizer-api
```

### Option B — GitHub Actions

Workflows:

- `.github/workflows/ci.yml` — test/build on PRs
- `.github/workflows/deploy.yml` — deploy on push to `main`

**GitHub → Settings → Secrets and variables → Actions**

Secrets:

| Secret | How to get it |
| --- | --- |
| `DATABASE_URL` | Neon connection string |
| `RAILWAY_TOKEN` | Railway project token |
| `CLOUDFLARE_API_TOKEN` | CF token with Pages Edit |
| `CLOUDFLARE_ACCOUNT_ID` | CF account id |

Variables (recommended):

| Variable | Example |
| --- | --- |
| `VITE_API_BASE` | `https://docs-organizer-api-production.up.railway.app` |
| `CORS_ORIGIN` | `https://docs-organizer.pages.dev` |
| `RAILWAY_PROJECT_ID` / `RAILWAY_SERVICE_ID` / `RAILWAY_ENVIRONMENT_ID` | From Railway dashboard / `railway status --json` |

Then:

```bash
git push origin main
```

More detail: [docs/DEPLOY.md](docs/DEPLOY.md).

### Post-deploy checklist

1. `GET /api/health` returns `{ "ok": true }`.
2. Open Pages URL → drop a sample invoice → job completes.
3. Confirm CORS: browser network tab shows `access-control-allow-origin` for the Pages origin.
4. Prefer R2 or a Railway volume if you need files to survive redeploys.

---

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness |
| `POST` | `/api/uploads` | Create document + upload target |
| `PUT` | `/api/uploads/:id/content` | Local multipart upload |
| `POST` | `/api/ocr-jobs` | Enqueue OCR `{ "documentId": "..." }` |
| `GET` | `/api/ocr-jobs/:id` | Poll job + document |
| `GET` | `/api/documents` | List / search |
| `GET` | `/api/documents/:id` | Detail |
| `POST` | `/api/documents/:id/reparse` | Re-parse fields from stored OCR text (no re-scan) |
| `PATCH` | `/api/documents/:id` | Manually correct fields |
| `DELETE` | `/api/documents/:id` | Delete |
| `GET` | `/api/documents/:id/file` | Download / preview |
| `GET` | `/api/export/csv` | Export CSV |

### What OCR extracts

- Vendor, invoice number, invoice/due dates  
- Currency, subtotal, tax (IVA), total  
- NIF / VAT id, guessed category  
- Organized name/path from those fields  

Parser is tuned for Portuguese documents (e.g. **Total a pagar**, **Total a Creditar**, **IVA Normal**) as well as common English labels.

---

## Useful scripts

```bash
npm run dev:api          # API with tsx watch
npm run dev:web          # Vite UI
npm run build            # Build all workspaces
npm run db:migrate       # Apply apps/api/src/db/schema.sql
npm test                 # Parser unit tests
npm run typecheck
npm run deploy:provision # scripts/provision-and-deploy.sh
```

---

## Notes & limitations

- **No auth** yet — anyone with the URL can upload/list documents.
- With `STORAGE_DRIVER=local` on Railway, uploaded files live on the container filesystem and can disappear on redeploy unless you add a volume or switch to R2.
- OCR quality depends on scan quality; use **Re-parse fields** after parser improvements, or **Re-run OCR** for a fresh scan.
- Cloudflare / Railway / Neon free tiers are enough for light hobby usage; heavy OCR volume will cost Railway compute.

---

## License

Private project (`yulelabs/docs_organizer`). Add a license file if you open-source it.
