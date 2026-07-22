import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const isProd = (process.env.NODE_ENV ?? "development") === "production";

export type OAuthProvider = "google" | "facebook" | "github";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required(
    "DATABASE_URL",
    isProd ? undefined : "postgresql://docs:docs@localhost:5432/docs_organizer",
  ),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  publicAppUrl:
    process.env.PUBLIC_APP_URL ?? process.env.CORS_ORIGIN?.split(",")[0]?.trim() ??
    "http://localhost:5173",
  publicApiUrl:
    process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  sessionSecret: required(
    "SESSION_SECRET",
    isProd ? undefined : "dev-session-secret-change-me",
  ),
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  cookieName: "docs_organizer_session",
  storageDriver: (process.env.STORAGE_DRIVER ?? "local") as "local" | "r2",
  localStorageDir: path.resolve(
    process.env.LOCAL_STORAGE_DIR ?? path.join(rootDir, "data/uploads"),
  ),
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET ?? "docs-organizer",
    publicUrl: process.env.R2_PUBLIC_URL ?? "",
  },
  ocrLang: process.env.OCR_LANG ?? "por+eng",
  ocrTmpDir: path.resolve(
    process.env.OCR_TMP_DIR ?? path.join(rootDir, "data/ocr-tmp"),
  ),
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    facebook: {
      clientId: process.env.FACEBOOK_APP_ID ?? "",
      clientSecret: process.env.FACEBOOK_APP_SECRET ?? "",
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
  },
  isDev: !isProd,
};

export function oauthEnabled(provider: OAuthProvider): boolean {
  const cfg = config.oauth[provider];
  return Boolean(cfg.clientId && cfg.clientSecret);
}
