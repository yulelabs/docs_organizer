import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  DocumentRecord,
  InvoiceFields,
  OcrJobRecord,
} from "@docs-organizer/shared";
import { api } from "./api";

type UploadNotice = { id: string; name: string; state: string };

function formatMoney(fields: InvoiceFields): string {
  if (fields.total == null) return "—";
  const currency = fields.currency ?? "EUR";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(fields.total);
  } catch {
    return `${currency} ${fields.total.toFixed(2)}`;
  }
}

function statusLabel(status: string) {
  return status.replace("_", " ");
}

export function App() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<OcrJobRecord | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<UploadNotice[]>([]);
  const [draft, setDraft] = useState<InvoiceFields | null>(null);
  const [pending, startTransition] = useTransition();
  const pollRef = useRef<number | null>(null);

  const selected = useMemo(
    () => documents.find((d) => d.id === selectedId) ?? null,
    [documents, selectedId],
  );

  async function refresh(selectId?: string | null) {
    const data = await api.listDocuments({
      q: query || undefined,
      status: statusFilter || undefined,
    });
    setDocuments(data.items);
    const nextId = selectId === undefined ? selectedId : selectId;
    if (nextId) {
      const detail = await api.getDocument(nextId);
      setSelectedJob(detail.job);
      setDraft(detail.document.fields);
      setDocuments((prev) => {
        const others = prev.filter((d) => d.id !== detail.document.id);
        return [detail.document, ...others].sort(
          (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
        );
      });
    }
  }

  useEffect(() => {
    startTransition(() => {
      refresh().catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      refresh().catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
    }, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, statusFilter]);

  useEffect(() => {
    if (
      !selectedJob ||
      selectedJob.status === "completed" ||
      selectedJob.status === "failed"
    ) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      return;
    }

    pollRef.current = window.setInterval(() => {
      api
        .getJob(selectedJob.id)
        .then((result) => {
          setSelectedJob(result.job);
          if (result.document) {
            setDocuments((prev) =>
              prev.map((d) => (d.id === result.document!.id ? result.document! : d)),
            );
            setDraft(result.document.fields);
          }
          if (result.job.status === "completed" || result.job.status === "failed") {
            refresh(result.job.documentId).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }, 1500);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob?.id, selectedJob?.status]);

  async function processFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;

    setBusy(true);
    setError(null);

    try {
      for (const file of files) {
        const noticeId = crypto.randomUUID();
        setNotices((prev) => [
          { id: noticeId, name: file.name, state: "Uploading…" },
          ...prev,
        ]);

        const created = await api.createUpload({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        });

        await api.uploadFile(created.document.id, created.upload, file);
        setNotices((prev) =>
          prev.map((n) =>
            n.id === noticeId ? { ...n, state: "Queued for OCR…" } : n,
          ),
        );

        const started = await api.startOcr(created.document.id);
        setDocuments((prev) => [started.document, ...prev]);
        setSelectedId(started.document.id);
        setSelectedJob(started.job);
        setDraft(started.document.fields);
        setNotices((prev) =>
          prev.map((n) =>
            n.id === noticeId ? { ...n, state: "Processing" } : n,
          ),
        );
      }
      await refresh(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      window.setTimeout(() => setNotices([]), 3500);
    }
  }

  async function selectDocument(id: string) {
    setSelectedId(id);
    setError(null);
    try {
      const detail = await api.getDocument(id);
      setSelectedJob(detail.job);
      setDraft(detail.document.fields);
      setDocuments((prev) =>
        prev.map((d) => (d.id === detail.document.id ? detail.document : d)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open document");
    }
  }

  async function saveFields() {
    if (!selected || !draft) return;
    setBusy(true);
    try {
      const result = await api.updateDocument(selected.id, draft);
      setDocuments((prev) =>
        prev.map((d) => (d.id === result.document.id ? result.document : d)),
      );
      setDraft(result.document.fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function reprocess() {
    if (!selected) return;
    setBusy(true);
    try {
      const started = await api.startOcr(selected.id);
      setSelectedJob(started.job);
      setDocuments((prev) =>
        prev.map((d) => (d.id === started.document.id ? started.document : d)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR failed to start");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    if (!window.confirm(`Delete ${selected.originalName}?`)) return;
    setBusy(true);
    try {
      await api.deleteDocument(selected.id);
      setSelectedId(null);
      setSelectedJob(null);
      setDraft(null);
      await refresh(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Docs Organizer</h1>
          <p>
            Drop invoices and receipts. OCR extracts the details and renames
            them into a clean archive.
          </p>
        </div>
        <div className="top-actions">
          <a className="btn btn-secondary" href={api.exportCsvUrl()}>
            Export CSV
          </a>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => refresh().catch(() => undefined)}
          >
            Refresh
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="layout">
        <section className="panel">
          <div
            className={`dropzone ${dragging ? "active" : ""}`}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void processFiles(e.dataTransfer.files);
            }}
          >
            <div>
              <h2>{dragging ? "Release to organize" : "Drop invoices here"}</h2>
              <p>PDF, PNG, JPG, WEBP, or TIFF — Portuguese + English OCR.</p>
              <p className="hint">or click to browse files</p>
            </div>
            <input
              className="file-input"
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,application/pdf,image/*"
              onChange={(e) => {
                if (e.target.files) void processFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {notices.length > 0 ? (
            <div className="toast-row">
              {notices.map((n) => (
                <span className="chip" key={n.id}>
                  {n.name}: {n.state}
                </span>
              ))}
            </div>
          ) : null}

          <div className="toolbar">
            <input
              placeholder="Search vendor, invoice #, filename…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search documents"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
              style={{ maxWidth: 180 }}
            >
              <option value="">All statuses</option>
              <option value="uploaded">Uploaded</option>
              <option value="queued">Queued</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          {documents.length === 0 ? (
            <div className="empty">
              {pending ? "Loading…" : "No documents yet. Drop a file to begin."}
            </div>
          ) : (
            <ul className="doc-list">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className={`doc-item ${selectedId === doc.id ? "selected" : ""}`}
                  onClick={() => void selectDocument(doc.id)}
                >
                  <div>
                    <strong>
                      {doc.organizedName ?? doc.originalName}
                    </strong>
                    <div className="meta">
                      {doc.fields.vendor ?? "Unknown vendor"} ·{" "}
                      {doc.fields.invoiceDate ?? "No date"} ·{" "}
                      {formatMoney(doc.fields)}
                    </div>
                  </div>
                  <span className={`status ${doc.status}`}>
                    {statusLabel(doc.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          {!selected || !draft ? (
            <div className="empty">
              Select a document to review extracted invoice data.
            </div>
          ) : (
            <div className="detail">
              <header>
                <div>
                  <h2>{selected.fields.vendor ?? selected.originalName}</h2>
                  <p className="path">
                    {selected.organizedPath ?? selected.originalName}
                  </p>
                </div>
                <span className={`status ${selected.status}`}>
                  {statusLabel(selected.status)}
                </span>
              </header>

              {selectedJob &&
              (selectedJob.status === "pending" ||
                selectedJob.status === "active") ? (
                <div>
                  <div className="meta" style={{ marginBottom: 6 }}>
                    OCR progress: {selectedJob.progress}%
                  </div>
                  <div className="progress">
                    <span style={{ width: `${selectedJob.progress}%` }} />
                  </div>
                </div>
              ) : null}

              {selected.error ? (
                <div className="error-banner">{selected.error}</div>
              ) : null}

              <div className="fields">
                {(
                  [
                    ["vendor", "Vendor"],
                    ["invoiceNumber", "Invoice #"],
                    ["invoiceDate", "Invoice date"],
                    ["dueDate", "Due date"],
                    ["currency", "Currency"],
                    ["total", "Total"],
                    ["tax", "Tax / IVA"],
                    ["subtotal", "Subtotal"],
                    ["nif", "NIF / VAT"],
                    ["category", "Category"],
                  ] as const
                ).map(([key, label]) => (
                  <div className="field" key={key}>
                    <label htmlFor={key}>{label}</label>
                    <input
                      id={key}
                      value={
                        draft[key] == null
                          ? ""
                          : String(draft[key])
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        setDraft((prev) => {
                          if (!prev) return prev;
                          if (
                            key === "total" ||
                            key === "tax" ||
                            key === "subtotal"
                          ) {
                            return {
                              ...prev,
                              [key]: value === "" ? null : Number(value),
                            };
                          }
                          return { ...prev, [key]: value || null };
                        });
                      }}
                    />
                  </div>
                ))}
                <div className="field full">
                  <label htmlFor="notes">Notes</label>
                  <textarea
                    id="notes"
                    rows={3}
                    value={draft.notes ?? ""}
                    onChange={(e) =>
                      setDraft((prev) =>
                        prev ? { ...prev, notes: e.target.value || null } : prev,
                      )
                    }
                  />
                </div>
              </div>

              {selected.rawText ? (
                <div>
                  <div className="field">
                    <label>Extracted text</label>
                  </div>
                  <div className="raw-text">{selected.rawText}</div>
                </div>
              ) : null}

              <div className="top-actions">
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void saveFields()}
                >
                  Save changes
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void reprocess()}
                >
                  Re-run OCR
                </button>
                <a
                  className="btn btn-secondary"
                  href={api.fileUrl(selected.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open file
                </a>
                <button
                  className="btn btn-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void removeSelected()}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
