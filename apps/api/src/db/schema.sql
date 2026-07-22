CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'queued', 'processing', 'completed', 'failed')),
  organized_name TEXT,
  organized_path TEXT,
  raw_text TEXT,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ocr_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_vendor
  ON documents ((fields->>'vendor'));
CREATE INDEX IF NOT EXISTS idx_documents_invoice_date
  ON documents ((fields->>'invoiceDate'));
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_document_id ON ocr_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status ON ocr_jobs(status);
