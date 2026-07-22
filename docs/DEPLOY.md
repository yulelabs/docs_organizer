# Deployment

Production target:

| Layer | Service | How it deploys |
| --- | --- | --- |
| Postgres | Neon | `DATABASE_URL` secret (or create via `neonctl` in `scripts/provision-and-deploy.sh`) |
| API + OCR | Railway (Docker) | GitHub Action + `railway.toml` / `apps/api/Dockerfile` |
| Frontend | Cloudflare Pages | GitHub Action + `wrangler pages deploy` |

## One-shot local/agent deploy

After CLI login (`neonctl auth`, `railway login`, `wrangler login`):

```bash
chmod +x scripts/provision-and-deploy.sh
./scripts/provision-and-deploy.sh
```

This will:

1. Create/find Neon project `docs-organizer`
2. Create/link Railway project and deploy the OCR API
3. Build the React app pointed at the Railway URL
4. Create/deploy Cloudflare Pages project `docs-organizer`

## GitHub Actions pipeline

Workflow: `.github/workflows/deploy.yml`

Runs on push to `main` (and manual `workflow_dispatch`).

### Required GitHub secrets

| Secret | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string |
| `RAILWAY_TOKEN` | Railway **project** token (preferred for `railway up`) |
| `CLOUDFLARE_API_TOKEN` | Token with Cloudflare Pages Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |

Optional: `RAILWAY_API_TOKEN` (account token) instead of project token.

### Required / useful GitHub variables

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE` | Public Railway API URL, e.g. `https://docs-organizer-production.up.railway.app` |
| `CORS_ORIGIN` | Pages URL, e.g. `https://docs-organizer.pages.dev` |
| `RAILWAY_PROJECT_ID` | Railway project id |
| `RAILWAY_ENVIRONMENT_ID` | Usually `production` env id |
| `RAILWAY_SERVICE_ID` | API service id |

### Quick setup checklist

1. Neon → create project → copy connection string → GitHub secret `DATABASE_URL`
2. Railway → New Project → Deploy from GitHub (`yulelabs/docs_organizer`) → set root Dockerfile `apps/api/Dockerfile` (or rely on `railway.toml`) → create project token → secret `RAILWAY_TOKEN`
3. Set Railway variables for email/password auth (required):

```text
SESSION_SECRET=<openssl rand -hex 32>
PUBLIC_APP_URL=https://docs-organizer.pages.dev
PUBLIC_API_URL=https://docs-organizer-api-production.up.railway.app
CORS_ORIGIN=https://docs-organizer.pages.dev
```

Also set: `DATABASE_URL`, `PORT=3000`, `OCR_LANG=por+eng`, `STORAGE_DRIVER=local`.

4. Optional OAuth — see README [Authentication provisioning (DevOps)](../README.md#authentication-provisioning-devops). Callbacks:

```text
https://docs-organizer-api-production.up.railway.app/api/auth/oauth/google/callback
https://docs-organizer-api-production.up.railway.app/api/auth/oauth/facebook/callback
https://docs-organizer-api-production.up.railway.app/api/auth/oauth/github/callback
```

5. Cloudflare → API token (Pages Edit) + account id → secrets
6. After first API domain exists, set variable `VITE_API_BASE=https://docs-organizer-api-production.up.railway.app` and redeploy Pages
7. Merge/push to `main` (or run the workflow manually) — boot migrate creates `users` / `sessions` tables

Neon’s GitHub integration can also inject `NEON_API_KEY` automatically if you connect the repo in the Neon console.
