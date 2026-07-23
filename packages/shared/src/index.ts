export type DocumentStatus =
  | "uploaded"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type JobStatus = "pending" | "active" | "completed" | "failed";

export type RoleSlug = "user" | "super_user" | "team_member";

export interface RoleRecord {
  slug: RoleSlug;
  name: string;
  description: string | null;
}

export interface InvoiceFields {
  vendor: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  nif: string | null;
  category: string | null;
  notes: string | null;
}

export interface DocumentRecord {
  id: string;
  userId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  status: DocumentStatus;
  organizedName: string | null;
  organizedPath: string | null;
  rawText: string | null;
  fields: InvoiceFields;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  roles: RoleSlug[];
  createdAt: string;
}

export interface AdminUserRecord extends UserRecord {
  updatedAt: string;
  teamIds: string[];
}

export interface TeamRecord {
  id: string;
  name: string;
  description: string | null;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type OAuthProvider = "google" | "facebook" | "github";

export interface AuthProvidersResponse {
  password: boolean;
  oauth: OAuthProvider[];
  /** Misconfigured / incomplete OAuth setup — for browser console warnings only. */
  warnings?: string[];
}

export interface AuthSessionResponse {
  user: UserRecord;
  token: string;
  expiresAt: string;
}

export interface OcrJobRecord {
  id: string;
  documentId: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateUploadResponse {
  document: DocumentRecord;
  upload: {
    mode: "local" | "r2";
    url: string;
    headers?: Record<string, string>;
  };
}

export interface CreateOcrJobResponse {
  job: OcrJobRecord;
  document: DocumentRecord;
}

export const ROLE_LABELS: Record<RoleSlug, string> = {
  user: "User",
  super_user: "Super User",
  team_member: "Team Member",
};

export function hasRole(user: Pick<UserRecord, "roles">, role: RoleSlug): boolean {
  return user.roles.includes(role);
}

export function isSuperUser(user: Pick<UserRecord, "roles">): boolean {
  return hasRole(user, "super_user");
}

export const emptyInvoiceFields = (): InvoiceFields => ({
  vendor: null,
  invoiceNumber: null,
  invoiceDate: null,
  dueDate: null,
  currency: null,
  subtotal: null,
  tax: null,
  total: null,
  nif: null,
  category: null,
  notes: null,
});
