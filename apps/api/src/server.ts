import fs from "node:fs/promises";
import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { config } from "./config.js";
import { apiRouter } from "./routes/api.js";
import { assertOcrToolsAvailable } from "./services/ocr.js";
import { startOcrWorker } from "./services/jobs.js";

async function main() {
  await fs.mkdir(config.localStorageDir, { recursive: true });
  await fs.mkdir(config.ocrTmpDir, { recursive: true });

  const app = express();
  app.use(
    cors({
      origin: config.corsOrigin.split(",").map((v) => v.trim()),
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/", (_req, res) => {
    res.json({
      name: "docs-organizer-api",
      version: "0.1.0",
      docs: "/api/health",
    });
  });

  app.use("/api", apiRouter);

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
  });
}

main().catch((err) => {
  console.error("Failed to start API:", err);
  process.exit(1);
});
