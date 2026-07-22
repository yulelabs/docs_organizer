import type {
  AuthSessionResponse,
  DocumentRecord,
  InvoiceFields,
  OAuthProvider,
  OcrJobRecord,
  UserRecord,
} from "@docs-organizer/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";
const TOKEN_KEY = "docs_organizer_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export const api = {
  getProviders() {
    return request<{ password: boolean; oauth: OAuthProvider[] }>(
      "/api/auth/providers",
    );
  },

  me() {
    return request<{ user: UserRecord }>("/api/auth/me");
  },

  register(input: { email: string; password: string; name?: string }) {
    return request<AuthSessionResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  login(input: { email: string; password: string }) {
    return request<AuthSessionResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  logout() {
    return request<void>("/api/auth/logout", { method: "POST", body: "{}" });
  },

  oauthUrl(provider: OAuthProvider, redirect = window.location.origin) {
    const params = new URLSearchParams({ redirect });
    return `${API_BASE}/api/auth/oauth/${provider}?${params}`;
  },

  listDocuments(params?: { q?: string; status?: string }) {
    const search = new URLSearchParams();
    if (params?.q) search.set("q", params.q);
    if (params?.status) search.set("status", params.status);
    const qs = search.toString();
    return request<{ items: DocumentRecord[]; total: number }>(
      `/api/documents${qs ? `?${qs}` : ""}`,
    );
  },

  getDocument(id: string) {
    return request<{ document: DocumentRecord; job: OcrJobRecord | null }>(
      `/api/documents/${id}`,
    );
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
      return request<{ document: DocumentRecord }>(
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
    return request<{ document: DocumentRecord }>(`/api/documents/${id}/reparse`, {
      method: "POST",
      body: "{}",
    });
  },

  getJob(id: string) {
    return request<{
      job: OcrJobRecord;
      document: DocumentRecord | null;
    }>(`/api/ocr-jobs/${id}`);
  },

  updateDocument(id: string, fields: Partial<InvoiceFields>) {
    return request<{ document: DocumentRecord }>(`/api/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });
  },

  deleteDocument(id: string) {
    return request<void>(`/api/documents/${id}`, { method: "DELETE" });
  },

  async downloadCsv() {
    const token = getStoredToken();
    const res = await fetch(`${API_BASE}/api/export/csv`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error("CSV export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "invoices.csv";
    a.click();
    URL.revokeObjectURL(url);
  },

  fileUrl(id: string) {
    const token = getStoredToken();
    const base = `${API_BASE}/api/documents/${id}/file`;
    return token ? `${base}?access_token=${encodeURIComponent(token)}` : base;
  },
};
