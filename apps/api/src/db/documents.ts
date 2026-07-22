import type {
  DocumentRecord,
  DocumentStatus,
  InvoiceFields,
  JobStatus,
  OcrJobRecord,
} from "@docs-organizer/shared";
import { emptyInvoiceFields } from "@docs-organizer/shared";
import { query } from "./client.js";

type DocumentRow = {
  id: string;
  user_id: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: string | number;
  storage_key: string;
  status: DocumentStatus;
  organized_name: string | null;
  organized_path: string | null;
  raw_text: string | null;
  fields: InvoiceFields | string;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  processed_at: Date | string | null;
};

type JobRow = {
  id: string;
  document_id: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
};

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function parseFields(raw: InvoiceFields | string): InvoiceFields {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as InvoiceFields) : raw;
  return { ...emptyInvoiceFields(), ...parsed };
}

export function mapDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    userId: row.user_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    status: row.status,
    organizedName: row.organized_name,
    organizedPath: row.organized_path,
    rawText: row.raw_text,
    fields: parseFields(row.fields),
    error: row.error,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    processedAt: toIso(row.processed_at),
  };
}

export function mapJob(row: JobRow): OcrJobRecord {
  return {
    id: row.id,
    documentId: row.document_id,
    status: row.status,
    progress: row.progress,
    error: row.error,
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
    completedAt: toIso(row.completed_at),
  };
}

export async function createDocument(input: {
  id: string;
  userId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}): Promise<DocumentRecord> {
  const result = await query<DocumentRow>(
    `INSERT INTO documents (id, user_id, original_name, mime_type, size_bytes, storage_key, status, fields)
     VALUES ($1, $2, $3, $4, $5, $6, 'uploaded', '{}'::jsonb)
     RETURNING *`,
    [
      input.id,
      input.userId,
      input.originalName,
      input.mimeType,
      input.sizeBytes,
      input.storageKey,
    ],
  );
  return mapDocument(result.rows[0]);
}

export async function getDocument(
  id: string,
  userId?: string,
): Promise<DocumentRecord | null> {
  const result = userId
    ? await query<DocumentRow>(
        `SELECT * FROM documents WHERE id = $1 AND user_id = $2`,
        [id, userId],
      )
    : await query<DocumentRow>(`SELECT * FROM documents WHERE id = $1`, [id]);
  return result.rows[0] ? mapDocument(result.rows[0]) : null;
}

export async function listDocuments(params: {
  userId: string;
  q?: string;
  status?: DocumentStatus;
  limit?: number;
  offset?: number;
}): Promise<{ items: DocumentRecord[]; total: number }> {
  const filters: string[] = ["user_id = $1"];
  const values: unknown[] = [params.userId];

  if (params.status) {
    values.push(params.status);
    filters.push(`status = $${values.length}`);
  }

  if (params.q) {
    values.push(`%${params.q}%`);
    filters.push(
      `(original_name ILIKE $${values.length}
        OR organized_name ILIKE $${values.length}
        OR fields->>'vendor' ILIKE $${values.length}
        OR fields->>'invoiceNumber' ILIKE $${values.length}
        OR raw_text ILIKE $${values.length})`,
    );
  }

  const where = `WHERE ${filters.join(" AND ")}`;
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM documents ${where}`,
    values,
  );

  const listValues = [...values, limit, offset];
  const result = await query<DocumentRow>(
    `SELECT * FROM documents
     ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    listValues,
  );

  return {
    items: result.rows.map(mapDocument),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function updateDocument(
  id: string,
  patch: Partial<{
    status: DocumentStatus;
    sizeBytes: number;
    organizedName: string | null;
    organizedPath: string | null;
    rawText: string | null;
    fields: InvoiceFields;
    error: string | null;
    processedAt: string | null;
  }>,
): Promise<DocumentRecord> {
  const sets: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [id];

  const setCol = (column: string, value: unknown, cast?: string) => {
    values.push(value);
    sets.push(
      `${column} = $${values.length}${cast ? `::${cast}` : ""}`,
    );
  };

  if (patch.status !== undefined) setCol("status", patch.status);
  if (patch.sizeBytes !== undefined) setCol("size_bytes", patch.sizeBytes);
  if (patch.organizedName !== undefined) setCol("organized_name", patch.organizedName);
  if (patch.organizedPath !== undefined) setCol("organized_path", patch.organizedPath);
  if (patch.rawText !== undefined) setCol("raw_text", patch.rawText);
  if (patch.fields !== undefined) {
    setCol("fields", JSON.stringify(patch.fields), "jsonb");
  }
  if (patch.error !== undefined) setCol("error", patch.error);
  if (patch.processedAt !== undefined) {
    setCol("processed_at", patch.processedAt, "timestamptz");
  }

  const result = await query<DocumentRow>(
    `UPDATE documents SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    values,
  );

  if (!result.rows[0]) {
    throw new Error(`Document not found: ${id}`);
  }
  return mapDocument(result.rows[0]);
}

export async function deleteDocument(id: string): Promise<void> {
  await query(`DELETE FROM documents WHERE id = $1`, [id]);
}

export async function createOcrJob(documentId: string): Promise<OcrJobRecord> {
  const result = await query<JobRow>(
    `INSERT INTO ocr_jobs (document_id, status, progress)
     VALUES ($1, 'pending', 0)
     RETURNING *`,
    [documentId],
  );
  return mapJob(result.rows[0]);
}

export async function getOcrJob(id: string): Promise<OcrJobRecord | null> {
  const result = await query<JobRow>(`SELECT * FROM ocr_jobs WHERE id = $1`, [id]);
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function getLatestOcrJob(
  documentId: string,
): Promise<OcrJobRecord | null> {
  const result = await query<JobRow>(
    `SELECT * FROM ocr_jobs
     WHERE document_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [documentId],
  );
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function updateOcrJob(
  id: string,
  patch: Partial<{
    status: JobStatus;
    progress: number;
    error: string | null;
    completedAt: string | null;
  }>,
): Promise<OcrJobRecord> {
  const sets: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [id];

  const setCol = (column: string, value: unknown, cast?: string) => {
    values.push(value);
    sets.push(
      `${column} = $${values.length}${cast ? `::${cast}` : ""}`,
    );
  };

  if (patch.status !== undefined) setCol("status", patch.status);
  if (patch.progress !== undefined) setCol("progress", patch.progress);
  if (patch.error !== undefined) setCol("error", patch.error);
  if (patch.completedAt !== undefined) {
    setCol("completed_at", patch.completedAt, "timestamptz");
  }

  const result = await query<JobRow>(
    `UPDATE ocr_jobs SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
    values,
  );
  if (!result.rows[0]) {
    throw new Error(`OCR job not found: ${id}`);
  }
  return mapJob(result.rows[0]);
}
