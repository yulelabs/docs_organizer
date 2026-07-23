import type { TeamRecord } from "@docs-organizer/shared";
import { query } from "./client.js";
import { getUserRoles } from "./users.js";

type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function memberIdsForTeam(teamId: string): Promise<string[]> {
  const result = await query<{ user_id: string }>(
    `SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY created_at`,
    [teamId],
  );
  return result.rows.map((row) => row.user_id);
}

async function mapTeam(row: TeamRow): Promise<TeamRecord> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    memberIds: await memberIdsForTeam(row.id),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function listTeams(): Promise<TeamRecord[]> {
  const result = await query<TeamRow>(
    `SELECT * FROM teams ORDER BY lower(name)`,
  );
  return Promise.all(result.rows.map(mapTeam));
}

export async function getTeam(id: string): Promise<TeamRecord | null> {
  const result = await query<TeamRow>(`SELECT * FROM teams WHERE id = $1`, [id]);
  if (!result.rows[0]) return null;
  return mapTeam(result.rows[0]);
}

export async function createTeam(input: {
  name: string;
  description?: string | null;
}): Promise<TeamRecord> {
  const result = await query<TeamRow>(
    `INSERT INTO teams (name, description)
     VALUES ($1, $2)
     RETURNING *`,
    [input.name.trim(), input.description?.trim() || null],
  );
  return mapTeam(result.rows[0]);
}

export async function updateTeam(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<TeamRecord> {
  const sets: string[] = ["updated_at = NOW()"];
  const values: unknown[] = [];

  if (patch.name !== undefined) {
    values.push(patch.name.trim());
    sets.push(`name = $${values.length}`);
  }
  if (patch.description !== undefined) {
    values.push(patch.description?.trim() || null);
    sets.push(`description = $${values.length}`);
  }

  values.push(id);
  const result = await query<TeamRow>(
    `UPDATE teams SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  if (!result.rows[0]) throw new Error("Team not found");
  return mapTeam(result.rows[0]);
}

export async function deleteTeam(id: string): Promise<void> {
  await query(`DELETE FROM teams WHERE id = $1`, [id]);
}

export async function setTeamMembers(
  teamId: string,
  userIds: string[],
): Promise<TeamRecord> {
  const unique = Array.from(new Set(userIds));

  for (const userId of unique) {
    const roles = await getUserRoles(userId);
    if (!roles.includes("team_member")) {
      throw new Error(
        "Only users with the Team Member role can be added to a team",
      );
    }
  }

  await query(`DELETE FROM team_members WHERE team_id = $1`, [teamId]);
  for (const userId of unique) {
    await query(
      `INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [teamId, userId],
    );
  }
  await query(`UPDATE teams SET updated_at = NOW() WHERE id = $1`, [teamId]);

  const team = await getTeam(teamId);
  if (!team) throw new Error("Team not found");
  return team;
}
