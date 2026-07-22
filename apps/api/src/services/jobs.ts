import fs from "node:fs/promises";
import path from "node:path";
import PgBoss from "pg-boss";
import { config } from "../config.js";
import {
  getDocument,
  updateDocument,
  updateOcrJob,
} from "../db/documents.js";
import { buildOrganizedName, parseInvoiceText } from "./invoice-parser.js";
import { ocrFile } from "./ocr.js";
import { storage } from "./storage.js";

export const OCR_QUEUE = "ocr";

let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  boss = new PgBoss({
    connectionString: config.databaseUrl,
    retryLimit: 2,
    retryDelay: 30,
  });
  boss.on("error", (err) => {
    console.error("[pg-boss]", err);
  });
  await boss.start();
  return boss;
}

export async function enqueueOcrJob(input: {
  jobId: string;
  documentId: string;
}): Promise<void> {
  const queue = await getBoss();
  await queue.createQueue(OCR_QUEUE);
  await queue.send(OCR_QUEUE, input, {
    singletonKey: input.documentId,
  });
}

export async function processOcrJob(data: {
  jobId: string;
  documentId: string;
}): Promise<void> {
  const document = await getDocument(data.documentId);
  if (!document) {
    throw new Error(`Document ${data.documentId} not found`);
  }

  await updateOcrJob(data.jobId, { status: "active", progress: 5 });
  await updateDocument(data.documentId, {
    status: "processing",
    error: null,
  });

  const tmpRoot = path.join(config.ocrTmpDir, `doc-${data.documentId}`);
  await fs.mkdir(tmpRoot, { recursive: true });
  const localFile = path.join(
    tmpRoot,
    path.basename(document.storageKey) || document.originalName,
  );

  try {
    await storage.downloadToFile(document.storageKey, localFile);
    await updateOcrJob(data.jobId, { progress: 15 });

    const rawText = await ocrFile({
      filePath: localFile,
      mimeType: document.mimeType,
      jobId: data.jobId,
      onProgress: async (progress) => {
        await updateOcrJob(data.jobId, { progress });
      },
    });

    const fields = parseInvoiceText(rawText);
    const organized = buildOrganizedName(fields, document.originalName);

    await updateDocument(data.documentId, {
      status: "completed",
      rawText,
      fields,
      organizedName: organized.organizedName,
      organizedPath: organized.organizedPath,
      processedAt: new Date().toISOString(),
      error: null,
    });

    await updateOcrJob(data.jobId, {
      status: "completed",
      progress: 100,
      completedAt: new Date().toISOString(),
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "OCR failed";
    await updateDocument(data.documentId, {
      status: "failed",
      error: message,
    });
    await updateOcrJob(data.jobId, {
      status: "failed",
      error: message,
      completedAt: new Date().toISOString(),
    });
    throw err;
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function startOcrWorker(): Promise<void> {
  const queue = await getBoss();
  await queue.createQueue(OCR_QUEUE);
  await queue.work<{ jobId: string; documentId: string }>(
    OCR_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await processOcrJob(job.data);
      }
    },
  );
  console.log("OCR worker listening on queue:", OCR_QUEUE);
}
