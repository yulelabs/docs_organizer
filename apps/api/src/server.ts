import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { config, inspectOAuthConfig } from "./config.js";
import { apiRouter } from "./routes/api.js";
import { assertOcrToolsAvailable } from "./services/ocr.js";
import { startOcrWorker } from "./services/jobs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDistCandidates = [
  path.resolve(here, "../../web/dist"),
  path.resolve(here, "../../../apps/web/dist"),
  path.resolve("/app/apps/web/dist"),
];

function resolveWebDist(): string | null {
  for (const candidate of webDistCandidates) {
    if (fs.existsSync(path.join(candidate, "index.html"))) {
      return candidate;
    }
  }
  return null;
}

async function main() {
  await fs.promises.mkdir(config.localStorageDir, { recursive: true });
  await fs.promises.mkdir(config.ocrTmpDir, { recursive: true });

  const app = express();
  const corsOrigins = config.corsOrigin
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: corsOrigins.includes("*") ? true : corsOrigins,
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));

  app.use("/api", apiRouter);

  app.get("/api", (_req, res) => {
    res.json({
      name: "docs-organizer-api",
      version: "0.2.0",
      docs: "/api/health",
      auth: "/api/auth/providers",
    });
  });

  const webDist = resolveWebDist();
  if (webDist) {
    console.log("Serving web UI from", webDist);
    app.use(express.static(webDist));
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, "index.html"));
    });
  } else {
    app.get("/", (_req, res) => {
      res.json({
        name: "docs-organizer-api",
        version: "0.2.0",
        docs: "/api/health",
      });
    });
  }

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "Invalid request", details: err.flatten() });
        return;
      }
      console.error(err);
      const message = err instanceof Error ? err.message : "Internal server error";
      res.status(500).json({ error: message });
    },
  );

  const tools = await assertOcrToolsAvailable();
  console.log("OCR tools:", tools);
  if (!tools.tesseract) {
    console.warn(
      "WARNING: tesseract not found. OCR jobs will fail until it is installed.",
    );
  }

  await startOcrWorker();

  app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
    console.log(`Storage driver: ${config.storageDriver}`);
    console.log(`Public app URL: ${config.publicAppUrl}`);
    console.log(`Public API URL: ${config.publicApiUrl}`);
    const oauth = inspectOAuthConfig();
    if (oauth.enabled.length) {
      console.log(`OAuth enabled: ${oauth.enabled.join(", ")}`);
    } else {
      console.log("OAuth: none (email/password only)");
    }
    for (const warning of oauth.warnings) {
      console.warn(`[oauth] ${warning}`);
    }
  });
}

main().catch((err) => {
  console.error("Failed to start API:", err);
  process.exit(1);
});
