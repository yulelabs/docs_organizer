import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { OAuthProvider } from "../config.js";
import type { AppLanguage, RoleSlug, UserRecord } from "@docs-organizer/shared";
import { query } from "./client.js";

export type { UserRecord };

type UserRow = {
  id: string;
  email: string;
  password_hash: string | null;
  name: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  preferred_language?: string | null;
  created_at: Date | string;
  updated_at?: Date | string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapLanguage(value: string | null | undefined): AppLanguage {
  return value === "en" ? "en" : "pt";
}

export function mapUser(row: UserRow, roles: RoleSlug[] = []): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    emailVerified: row.email_verified,
    hasPassword: Boolean(row.password_hash),
    roles,
    preferredLanguage: mapLanguage(row.preferred_language),
    createdAt: toIso(row.created_at),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function getUserRoles(userId: string): Promise<RoleSlug[]> {
  const result = await query<{ slug: RoleSlug }>(
    `SELECT r.slug
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
     ORDER BY r.slug`,
    [userId],
  );
  return result.rows.map((row) => row.slug);
}

export async function listRoles(): Promise<
  Array<{ slug: RoleSlug; name: string; description: string | null }>
> {
  const result = await query<{
    slug: RoleSlug;
    name: string;
    description: string | null;
  }>(`SELECT slug, name, description FROM roles ORDER BY slug`);
  return result.rows;
}

export async function assignRoles(
  userId: string,
  roles: RoleSlug[],
): Promise<void> {
  const unique = Array.from(new Set(roles));
  if (!unique.includes("user")) unique.push("user");

  await query(`DELETE FROM user_roles WHERE user_id = $1`, [userId]);
  if (unique.length === 0) return;

  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, r.id FROM roles r WHERE r.slug = ANY($2::text[])`,
    [userId, unique],
  );

  // Team membership requires team_member role
  if (!unique.includes("team_member")) {
    await query(`DELETE FROM team_members WHERE user_id = $1`, [userId]);
  }
}

export async function ensureDefaultUserRole(userId: string): Promise<void> {
  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, r.id FROM roles r WHERE r.slug = 'user'
     ON CONFLICT DO NOTHING`,
    [userId],
  );
}

async function withRoles(row: UserRow): Promise<UserRecord> {
  const roles = await getUserRoles(row.id);
  return mapUser(row, roles);
}

export async function findUserByEmail(
  email: string,
): Promise<(UserRecord & { passwordHash: string | null }) | null> {
  const result = await query<UserRow>(
    `SELECT * FROM users WHERE lower(email) = lower($1)`,
    [email.trim()],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return { ...(await withRoles(row)), passwordHash: row.password_hash };
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const result = await query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
  if (!result.rows[0]) return null;
  return withRoles(result.rows[0]);
}

export async function createUserWithPassword(input: {
  email: string;
  password: string;
  name?: string | null;
  roles?: RoleSlug[];
  emailVerified?: boolean;
}): Promise<UserRecord> {
  const passwordHash = await hashPassword(input.password);
  const result = await query<UserRow>(
    `INSERT INTO users (email, password_hash, name, email_verified)
     VALUES (lower($1), $2, $3, $4)
     RETURNING *`,
    [
      input.email.trim(),
      passwordHash,
      input.name?.trim() || null,
      input.emailVerified ?? false,
    ],
  );
  const userId = result.rows[0].id;
  await assignRoles(userId, input.roles ?? ["user"]);
  return (await findUserById(userId))!;
}

export async function updateUserDetails(
  id: string,
  patch: {
    email?: string;
    name?: string | null;
    emailVerified?: boolean;
    preferredLanguage?: AppLanguage;
  },
): Promise<UserRecord> {
  const sets: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [];

  if (patch.email !== undefined) {
    values.push(patch.email.trim().toLowerCase());
    sets.push(`email = $${values.length}`);
  }
  if (patch.name !== undefined) {
    values.push(patch.name?.trim() || null);
    sets.push(`name = $${values.length}`);
  }
  if (patch.emailVerified !== undefined) {
    values.push(patch.emailVerified);
    sets.push(`email_verified = $${values.length}`);
  }
  if (patch.preferredLanguage !== undefined) {
    values.push(patch.preferredLanguage);
    sets.push(`preferred_language = $${values.length}`);
  }

  values.push(id);
  const result = await query<UserRow>(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (!result.rows[0]) throw new Error("User not found");
  return withRoles(result.rows[0]);
}

export async function setPreferredLanguage(
  id: string,
  language: AppLanguage,
): Promise<UserRecord> {
  return updateUserDetails(id, { preferredLanguage: language });
}

export async function setUserPassword(
  id: string,
  password: string,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  await query(
    `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [id, passwordHash],
  );
}

export async function listUsersAdmin(): Promise<
  Array<
    UserRecord & {
      updatedAt: string;
      teamIds: string[];
    }
  >
> {
  const users = await query<UserRow>(
    `SELECT * FROM users ORDER BY created_at DESC`,
  );
  const roles = await query<{ user_id: string; slug: RoleSlug }>(
    `SELECT ur.user_id, r.slug
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id`,
  );
  const teams = await query<{ user_id: string; team_id: string }>(
    `SELECT user_id, team_id FROM team_members`,
  );

  const rolesByUser = new Map<string, RoleSlug[]>();
  for (const row of roles.rows) {
    const list = rolesByUser.get(row.user_id) ?? [];
    list.push(row.slug);
    rolesByUser.set(row.user_id, list);
  }
  const teamsByUser = new Map<string, string[]>();
  for (const row of teams.rows) {
    const list = teamsByUser.get(row.user_id) ?? [];
    list.push(row.team_id);
    teamsByUser.set(row.user_id, list);
  }

  return users.rows.map((row) => ({
    ...mapUser(row, rolesByUser.get(row.id) ?? []),
    updatedAt: toIso(row.updated_at ?? row.created_at),
    teamIds: teamsByUser.get(row.id) ?? [],
  }));
}

export async function findOrCreateOAuthUser(input: {
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean;
}): Promise<UserRecord> {
  const existingAccount = await query<{ user_id: string }>(
    `SELECT user_id FROM oauth_accounts
     WHERE provider = $1 AND provider_user_id = $2`,
    [input.provider, input.providerUserId],
  );
  if (existingAccount.rows[0]) {
    const user = await findUserById(existingAccount.rows[0].user_id);
    if (!user) throw new Error("OAuth account linked to missing user");
    return user;
  }

  const existingByEmail = await findUserByEmail(input.email);
  let userId: string;

  if (!existingByEmail) {
    const created = await query<UserRow>(
      `INSERT INTO users (email, name, avatar_url, email_verified)
       VALUES (lower($1), $2, $3, $4)
       RETURNING *`,
      [
        input.email.trim(),
        input.name?.trim() || null,
        input.avatarUrl ?? null,
        input.emailVerified ?? true,
      ],
    );
    userId = created.rows[0].id;
    await ensureDefaultUserRole(userId);
  } else {
    userId = existingByEmail.id;
    if (input.avatarUrl || input.name) {
      await query(
        `UPDATE users SET
           name = COALESCE($2, name),
           avatar_url = COALESCE($3, avatar_url),
           email_verified = email_verified OR $4,
           updated_at = NOW()
         WHERE id = $1`,
        [
          userId,
          input.name ?? null,
          input.avatarUrl ?? null,
          input.emailVerified ?? true,
        ],
      );
    }
  }

  await query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, provider_user_id) DO NOTHING`,
    [userId, input.provider, input.providerUserId],
  );

  const user = await findUserById(userId);
  if (!user) throw new Error("Failed to load OAuth user");
  return user;
}

export async function createSession(
  userId: string,
  days: number,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashToken(token), expiresAt.toISOString()],
  );
  return { token, expiresAt };
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

export async function findUserBySessionToken(
  token: string,
): Promise<UserRecord | null> {
  const result = await query<UserRow & { session_id: string }>(
    `SELECT u.*, s.id AS session_id
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashToken(token)],
  );
  if (!result.rows[0]) return null;
  await query(
    `UPDATE sessions SET last_seen_at = NOW() WHERE id = $1`,
    [result.rows[0].session_id],
  );
  return withRoles(result.rows[0]);
}

export async function saveOAuthState(input: {
  state: string;
  provider: OAuthProvider;
  codeVerifier?: string | null;
  redirectTo?: string | null;
  ttlMinutes?: number;
}): Promise<void> {
  const expiresAt = new Date(
    Date.now() + (input.ttlMinutes ?? 10) * 60 * 1000,
  );
  await query(
    `INSERT INTO oauth_states (state, provider, code_verifier, redirect_to, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.state,
      input.provider,
      input.codeVerifier ?? null,
      input.redirectTo ?? null,
      expiresAt.toISOString(),
    ],
  );
}

export async function consumeOAuthState(state: string): Promise<{
  provider: OAuthProvider;
  codeVerifier: string | null;
  redirectTo: string | null;
} | null> {
  const result = await query<{
    provider: OAuthProvider;
    code_verifier: string | null;
    redirect_to: string | null;
  }>(
    `DELETE FROM oauth_states
     WHERE state = $1 AND expires_at > NOW()
     RETURNING provider, code_verifier, redirect_to`,
    [state],
  );
  if (!result.rows[0]) return null;
  return {
    provider: result.rows[0].provider,
    codeVerifier: result.rows[0].code_verifier,
    redirectTo: result.rows[0].redirect_to,
  };
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
