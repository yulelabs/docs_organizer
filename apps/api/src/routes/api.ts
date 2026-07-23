import { Router } from "express";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  createDocument,
  createOcrJob,
  deleteDocument,
  getDocument,
  getLatestOcrJob,
  getOcrJob,
  listDocuments,
  updateDocument,
} from "../db/documents.js";
import { enqueueOcrJob } from "../services/jobs.js";
import { buildOrganizedName, parseInvoiceText } from "../services/invoice-parser.js";
import { storage } from "../services/storage.js";
import { emptyInvoiceFields, type InvoiceFields } from "@docs-organizer/shared";
import {
  attachUser,
  requireAuth,
  type AuthedRequest,
} from "../middleware/auth.js";
import { authRouter } from "./auth.js";
import { adminRouter } from "./admin.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
});

const allowedMime = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/tiff",
]);

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function extensionFor(mimeType: string, originalName: string): string {
  const fromName = originalName.includes(".")
    ? originalName.slice(originalName.lastIndexOf(".")).toLowerCase()
    : "";
  if (fromName) return fromName;
  switch (mimeType) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/tiff":
      return ".tiff";
    default:
      return ".jpg";
  }
}

export const apiRouter = Router();

apiRouter.use(attachUser);
apiRouter.use("/auth", authRouter);
apiRouter.use("/admin", adminRouter);

apiRouter.get("/health", (_req, res) => {
  res.json({ ok: true, storage: storage.mode() });
});

apiRouter.post("/uploads", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        fileName: z.string().min(1).max(255),
        mimeType: z.string().min(1),
        sizeBytes: z.number().int().nonnegative().optional(),
      })
      .parse(req.body);

    if (!allowedMime.has(body.mimeType)) {
      res.status(400).json({
        error: "Unsupported file type. Use PDF, PNG, JPG, WEBP, or TIFF.",
      });
      return;
    }

    const id = uuidv4();
    const ext = extensionFor(body.mimeType, body.fileName);
    const storageKey = `invoices/${req.user!.id}/${id}${ext}`;

    const document = await createDocument({
      id,
      userId: req.user!.id,
      originalName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes ?? 0,
      storageKey,
    });

    const uploadTarget = await storage.createUploadTarget({
      key: storageKey,
      mimeType: body.mimeType,
      documentId: id,
    });

    res.status(201).json({
      document,
      upload: uploadTarget,
    });
  } catch (err) {
    next(err);
  }
});

apiRouter.put(
  "/uploads/:id/content",
  requireAuth,
  upload.single("file"),
  async (req: AuthedRequest, res, next) => {
    try {
      const document = await getDocument(paramId(req.params.id), req.user!.id);
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      if (!req.file) {
        res.status(400).json({ error: "Missing file upload" });
        return;
      }

      if (!allowedMime.has(req.file.mimetype) && !allowedMime.has(document.mimeType)) {
        res.status(400).json({ error: "Unsupported file type" });
        return;
      }

      await storage.putLocal(
        document.storageKey,
        req.file.buffer,
        req.file.mimetype || document.mimeType,
      );

      const updated = await updateDocument(document.id, {
        sizeBytes: req.file.size,
        status: "uploaded",
      });

      res.json({ document: updated });
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.post("/ocr-jobs", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        documentId: z.string().uuid(),
      })
      .parse(req.body);

    const document = await getDocument(body.documentId, req.user!.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const job = await createOcrJob(document.id);
    await updateDocument(document.id, { status: "queued", error: null });
    await enqueueOcrJob({ jobId: job.id, documentId: document.id });

    const refreshed = await getDocument(document.id, req.user!.id);
    res.status(201).json({ job, document: refreshed });
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/ocr-jobs/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const job = await getOcrJob(paramId(req.params.id));
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const document = await getDocument(job.documentId, req.user!.id);
    if (!document) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ job, document });
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/documents", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const status =
      typeof req.query.status === "string"
        ? (req.query.status as
            | "uploaded"
            | "queued"
            | "processing"
            | "completed"
            | "failed")
        : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const result = await listDocuments({
      userId: req.user!.id,
      q,
      status,
      limit,
      offset,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/documents/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const document = await getDocument(paramId(req.params.id), req.user!.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const job = await getLatestOcrJob(document.id);
    res.json({ document, job });
  } catch (err) {
    next(err);
  }
});

apiRouter.post(
  "/documents/:id/reparse",
  requireAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const document = await getDocument(paramId(req.params.id), req.user!.id);
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      if (!document.rawText) {
        res.status(400).json({ error: "No OCR text available to reparse" });
        return;
      }

      const fields = parseInvoiceText(document.rawText);
      const organized = buildOrganizedName(fields, document.originalName);
      const updated = await updateDocument(document.id, {
        fields,
        organizedName: organized.organizedName,
        organizedPath: organized.organizedPath,
        status: "completed",
        error: null,
        processedAt: new Date().toISOString(),
      });

      res.json({ document: updated });
    } catch (err) {
      next(err);
    }
  },
);

apiRouter.patch("/documents/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = z
      .object({
        fields: z
          .object({
            vendor: z.string().nullable().optional(),
            invoiceNumber: z.string().nullable().optional(),
            invoiceDate: z.string().nullable().optional(),
            dueDate: z.string().nullable().optional(),
            currency: z.string().nullable().optional(),
            subtotal: z.number().nullable().optional(),
            tax: z.number().nullable().optional(),
            total: z.number().nullable().optional(),
            nif: z.string().nullable().optional(),
            category: z.string().nullable().optional(),
            notes: z.string().nullable().optional(),
          })
          .optional(),
      })
      .parse(req.body);

    const document = await getDocument(paramId(req.params.id), req.user!.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    const fields: InvoiceFields = {
      ...emptyInvoiceFields(),
      ...document.fields,
      ...body.fields,
    };

    const organized = buildOrganizedName(fields, document.originalName);
    const updated = await updateDocument(document.id, {
      fields,
      organizedName: organized.organizedName,
      organizedPath: organized.organizedPath,
    });

    res.json({ document: updated });
  } catch (err) {
    next(err);
  }
});

apiRouter.delete("/documents/:id", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const document = await getDocument(paramId(req.params.id), req.user!.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    await storage.deleteObject(document.storageKey);
    await deleteDocument(document.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/documents/:id/file", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const document = await getDocument(paramId(req.params.id), req.user!.id);
    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    const buffer = await storage.readBuffer(document.storageKey);
    const filename = document.organizedName ?? document.originalName;
    res.setHeader("Content-Type", document.mimeType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename.replace(/"/g, "")}"`,
    );
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

apiRouter.get("/export/csv", requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { items } = await listDocuments({
      userId: req.user!.id,
      limit: 1000,
      offset: 0,
    });
    const header = [
      "id",
      "original_name",
      "organized_name",
      "organized_path",
      "vendor",
      "invoice_number",
      "invoice_date",
      "due_date",
      "currency",
      "subtotal",
      "tax",
      "total",
      "nif",
      "category",
      "status",
      "created_at",
    ];

    const escape = (value: unknown) => {
      const str = value == null ? "" : String(value);
      if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

    const rows = items.map((doc) =>
      [
        doc.id,
        doc.originalName,
        doc.organizedName,
        doc.organizedPath,
        doc.fields.vendor,
        doc.fields.invoiceNumber,
        doc.fields.invoiceDate,
        doc.fields.dueDate,
        doc.fields.currency,
        doc.fields.subtotal,
        doc.fields.tax,
        doc.fields.total,
        doc.fields.nif,
        doc.fields.category,
        doc.status,
        doc.createdAt,
      ]
        .map(escape)
        .join(","),
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="invoices.csv"',
    );
    res.send([header.join(","), ...rows].join("\n"));
  } catch (err) {
    next(err);
  }
});
