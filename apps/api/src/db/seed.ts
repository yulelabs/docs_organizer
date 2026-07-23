import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { pool } from "./client.js";

const SUPER_ADMIN_EMAIL = "yulelabs.com@gmail.com";
const SUPER_ADMIN_PASSWORD = "changeme";
const SUPER_ADMIN_NAME = "Yulelabs Admin";

async function ensureRole(
  client: PoolClient,
  slug: string,
  name: string,
  description: string,
) {
  await client.query(
    `INSERT INTO roles (slug, name, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description`,
    [slug, name, description],
  );
}

export async function seedRolesAndSuperAdmin(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await ensureRole(
      client,
      "user",
      "User",
      "Standard account with a private document archive",
    );
    await ensureRole(
      client,
      "super_user",
      "Super User",
      "Can manage users, roles, and teams",
    );
    await ensureRole(
      client,
      "team_member",
      "Team Member",
      "Can be assigned to teams",
    );

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1)`,
      [SUPER_ADMIN_EMAIL],
    );

    let userId = existing.rows[0]?.id;
    if (!userId) {
      const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 12);
      const created = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, name, email_verified)
         VALUES (lower($1), $2, $3, TRUE)
         RETURNING id`,
        [SUPER_ADMIN_EMAIL, passwordHash, SUPER_ADMIN_NAME],
      );
      userId = created.rows[0].id;
      console.log(`Seeded super admin user: ${SUPER_ADMIN_EMAIL}`);
    } else {
      console.log(`Super admin already exists: ${SUPER_ADMIN_EMAIL}`);
    }

    // Always ensure user + super_user roles (do not reset password on existing account)
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, r.id FROM roles r WHERE r.slug IN ('user', 'super_user')
       ON CONFLICT DO NOTHING`,
      [userId],
    );

    // Backfill default User role for any account missing roles
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT u.id, r.id
       FROM users u
       CROSS JOIN roles r
       WHERE r.slug = 'user'
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
         )
       ON CONFLICT DO NOTHING`,
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
