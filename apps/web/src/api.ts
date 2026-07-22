const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export const api = {
  listDocuments(params?: { q?: string; status?: string }) {
    const search = new URLSearchParams();
    if (params?.q) search.set("q", params.q);
    if (params?.status) search.set("status", params.status);
    const qs = search.toString();
    return request<{
      items: import("@docs-organizer/shared").DocumentRecord[];
      total: number;
    }>(`/api/documents${qs ? `?${qs}` : ""}`);
  },

  getDocument(id: string) {
    return request<{
      document: import("@docs-organizer/shared").DocumentRecord;
      job: import("@docs-organizer/shared").OcrJobRecord | null;
    }>(`/api/documents/${id}`);
  },

  createUpload(input: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    return request<import("@docs-organizer/shared").CreateUploadResponse>(
      "/api/uploads",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },

  async uploadFile(
    _documentId: string,
    upload: { mode: "local" | "r2"; url: string; headers?: Record<string, string> },
    file: File,
  ) {
    if (upload.mode === "local") {
      const form = new FormData();
      form.append("file", file);
      return request<{ document: import("@docs-organizer/shared").DocumentRecord }>(
        upload.url.startsWith("http") ? upload.url : upload.url,
        {
          method: "PUT",
          body: form,
        },
      );
    }

    const res = await fetch(upload.url, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
        ...upload.headers,
      },
      body: file,
    });
    if (!res.ok) {
      throw new Error(`R2 upload failed (${res.status})`);
    }
  },

  startOcr(documentId: string) {
    return request<import("@docs-organizer/shared").CreateOcrJobResponse>(
      "/api/ocr-jobs",
      {
        method: "POST",
        body: JSON.stringify({ documentId }),
      },
    );
  },

  reparseDocument(id: string) {
    return request<{ document: import("@docs-organizer/shared").DocumentRecord }>(
      `/api/documents/${id}/reparse`,
      { method: "POST", body: "{}" },
    );
  },

  getJob(id: string) {
    return request<{
      job: import("@docs-organizer/shared").OcrJobRecord;
      document: import("@docs-organizer/shared").DocumentRecord | null;
    }>(`/api/ocr-jobs/${id}`);
  },

  updateDocument(
    id: string,
    fields: Partial<import("@docs-organizer/shared").InvoiceFields>,
  ) {
    return request<{ document: import("@docs-organizer/shared").DocumentRecord }>(
      `/api/documents/${id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ fields }),
      },
    );
  },

  deleteDocument(id: string) {
    return request<void>(`/api/documents/${id}`, { method: "DELETE" });
  },

  exportCsvUrl() {
    return `${API_BASE}/api/export/csv`;
  },

  fileUrl(id: string) {
    return `${API_BASE}/api/documents/${id}/file`;
  },
};
