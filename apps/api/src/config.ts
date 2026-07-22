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

const OAUTH_ENV_LABELS: Record<
  OAuthProvider,
  { id: string; secret: string }
> = {
  google: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
  facebook: { id: "FACEBOOK_APP_ID", secret: "FACEBOOK_APP_SECRET" },
  github: { id: "GITHUB_CLIENT_ID", secret: "GITHUB_CLIENT_SECRET" },
};

function trimEnv(value: string | undefined): string {
  return (value ?? "").trim();
}

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
      clientId: trimEnv(process.env.GOOGLE_CLIENT_ID),
      clientSecret: trimEnv(process.env.GOOGLE_CLIENT_SECRET),
    },
    facebook: {
      clientId: trimEnv(process.env.FACEBOOK_APP_ID),
      clientSecret: trimEnv(process.env.FACEBOOK_APP_SECRET),
    },
    github: {
      clientId: trimEnv(process.env.GITHUB_CLIENT_ID),
      clientSecret: trimEnv(process.env.GITHUB_CLIENT_SECRET),
    },
  },
  isDev: !isProd,
};

/** Provider is shown in the UI only when both id and secret look usable. */
export function oauthEnabled(provider: OAuthProvider): boolean {
  const cfg = config.oauth[provider];
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.clientId.length >= 8 && cfg.clientSecret.length >= 8);
}

/**
 * Inspect OAuth env. Incomplete / invalid keys never enable the provider
 * (email/password keeps working). Warnings are for ops + browser console.
 */
export function inspectOAuthConfig(): {
  enabled: OAuthProvider[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const enabled: OAuthProvider[] = [];

  for (const provider of ["google", "facebook", "github"] as OAuthProvider[]) {
    const { clientId, clientSecret } = config.oauth[provider];
    const labels = OAUTH_ENV_LABELS[provider];

    if (!clientId && !clientSecret) continue;

    if (clientId && !clientSecret) {
      warnings.push(
        `${provider}: ${labels.secret} is missing while ${labels.id} is set. Social login for ${provider} is disabled; email/password still works.`,
      );
      continue;
    }
    if (!clientId && clientSecret) {
      warnings.push(
        `${provider}: ${labels.id} is missing while ${labels.secret} is set. Social login for ${provider} is disabled; email/password still works.`,
      );
      continue;
    }
    if (clientId.length < 8 || clientSecret.length < 8) {
      warnings.push(
        `${provider}: OAuth credentials look invalid (too short). Social login for ${provider} is disabled; email/password still works.`,
      );
      continue;
    }

    enabled.push(provider);
  }

  if (enabled.length > 0) {
    if (!process.env.PUBLIC_API_URL?.trim()) {
      warnings.push(
        "OAuth keys are set but PUBLIC_API_URL is unset. Callback URLs may be wrong — set PUBLIC_API_URL to the Railway API origin.",
      );
    }
    if (!process.env.PUBLIC_APP_URL?.trim() && !process.env.CORS_ORIGIN?.trim()) {
      warnings.push(
        "OAuth keys are set but PUBLIC_APP_URL is unset. Post-login redirects may fail — set PUBLIC_APP_URL to the Pages origin.",
      );
    }
  }

  return { enabled, warnings };
}
