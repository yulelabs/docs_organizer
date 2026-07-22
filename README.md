# Docs Organizer

Web app that organizes invoices and receipts with OCR — the online version of a local “invoice data organization” workflow.

Drop PDFs or photos, extract text (Portuguese + English), parse vendor / date / totals, and rename files into a tidy archive path like:

`2024/03/supermarket/2024-03-15_continente_EUR42.90.pdf`

## Architecture

| Piece | Local | Production (suggested) |
| --- | --- | --- |
| React UI | Vite | Cloudflare Pages |
| Node.js API + OCR worker | same process | Railway (Docker) |
| Postgres | Docker Compose | Neon |
| Files | `./data/uploads` | Cloudflare R2 |
| Jobs | pg-boss | pg-boss |

No authentication yet — add later.

## Quick start

### 1. Dependencies

```bash
cp .env.example .env
npm install
```

### 2. Postgres

```bash
docker compose up -d postgres
npm run db:migrate
```

### 3. OCR tools (local API, not Docker)

```bash
# Debian/Ubuntu
sudo apt-get install -y tesseract-ocr tesseract-ocr-por tesseract-ocr-eng poppler-utils imagemagick
```

Or run the API via Docker (tools included):

```bash
docker compose up --build api
```

### 4. Dev servers

```bash
npm run dev:api
npm run dev:web
```

- UI: http://localhost:5173  
- API: http://localhost:3000  

## What it does

1. **Upload** — drag-and-drop invoices (PDF / images)
2. **Queue OCR** — async job via pg-boss (HTTP returns immediately)
3. **Process** — PDF → images (`pdftoppm`) → Tesseract → structured fields
4. **Organize** — suggested filename + year/month/category path
5. **Review** — edit fields, re-run OCR, export CSV, open original file

## API

- `POST /api/uploads` — create document + upload target (local PUT or R2 signed URL)
- `PUT /api/uploads/:id/content` — local multipart upload
- `POST /api/ocr-jobs` — enqueue OCR `{ "documentId": "..." }`
- `GET /api/ocr-jobs/:id` — poll job status
- `GET /api/documents` — list / search
- `GET /api/documents/:id` — detail
- `PATCH /api/documents/:id` — correct extracted fields
- `DELETE /api/documents/:id`
- `GET /api/documents/:id/file` — download / preview
- `GET /api/export/csv`

## Cloudflare R2

Set in `.env`:

```env
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=docs-organizer
```

The UI uploads directly to R2 with a signed URL, then asks the API to OCR the object key.

## Railway deploy

1. Connect this repo; root Dockerfile is `apps/api/Dockerfile`
2. Set `DATABASE_URL` (Neon), `CORS_ORIGIN` (Pages URL), R2 vars if used
3. Deploy — container runs migrations, then API + in-process OCR worker

## Cloudflare Pages

Build:

- root: `apps/web`
- command: `npm install && npm run build -w @docs-organizer/shared && npm run build -w @docs-organizer/web`
- output: `apps/web/dist`
- env: `VITE_API_BASE=https://your-api.up.railway.app`

## Monorepo layout

```
apps/api      OCR API + worker
apps/web      React UI
packages/shared   Shared TypeScript types
```

## Deploy (Neon + Railway + Cloudflare)

See [docs/DEPLOY.md](docs/DEPLOY.md).

- GitHub Actions: `.github/workflows/deploy.yml` (push to `main`)
- One-shot after CLI login: `./scripts/provision-and-deploy.sh`

Required GitHub secrets for CI: `DATABASE_URL`, `RAILWAY_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

