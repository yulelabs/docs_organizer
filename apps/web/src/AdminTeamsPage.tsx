import { useEffect, useMemo, useState } from "react";
import type {
  AdminUserRecord,
  TeamRecord,
  UserRecord,
} from "@docs-organizer/shared";
import { api } from "./api";

export function AdminTeamsPage(props: {
  currentUser: UserRecord;
  onBack: () => void;
}) {
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const teamMembers = useMemo(
    () => users.filter((u) => u.roles.includes("team_member")),
    [users],
  );

  const selected = useMemo(
    () => teams.find((t) => t.id === selectedId) ?? null,
    [teams, selectedId],
  );

  async function refresh() {
    const [teamsRes, usersRes] = await Promise.all([
      api.adminListTeams(),
      api.adminListUsers(),
    ]);
    setTeams(teamsRes.teams);
    setUsers(usersRes.users);
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load teams"),
    );
  }, []);

  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setDescription(selected.description ?? "");
    setMemberIds(selected.memberIds);
  }, [selected]);

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.adminCreateTeam({
        name: createName,
        description: createDescription || null,
      });
      setCreateName("");
      setCreateDescription("");
      await refresh();
      setSelectedId(created.team.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminUpdateTeam(selected.id, {
        name,
        description: description || null,
      });
      await api.adminSetTeamMembers(selected.id, memberIds);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function removeTeam() {
    if (!selected) return;
    if (!window.confirm(`Delete team “${selected.name}”?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminDeleteTeam(selected.id);
      setSelectedId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleMember(userId: string) {
    setMemberIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Manage teams</h1>
          <p>
            Teams can be empty or include Team Member users only.
          </p>
        </div>
        <div className="top-actions">
          <button className="btn btn-secondary" type="button" onClick={props.onBack}>
            Back to archive
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="admin-layout">
        <section className="panel admin-panel">
          <div className="admin-section-head">
            <h2>Teams</h2>
            <span className="meta">{teams.length} total</span>
          </div>
          <ul className="doc-list">
            {teams.map((team) => (
              <li
                key={team.id}
                className={`doc-item${selectedId === team.id ? " selected" : ""}`}
                onClick={() => setSelectedId(team.id)}
              >
                <div>
                  <strong>{team.name}</strong>
                  <div className="meta">
                    {team.memberIds.length} member
                    {team.memberIds.length === 1 ? "" : "s"}
                  </div>
                </div>
              </li>
            ))}
            {teams.length === 0 ? (
              <li className="empty">No teams yet.</li>
            ) : null}
          </ul>
        </section>

        <section className="panel admin-panel">
          <div className="admin-section-head">
            <h2>Create team</h2>
          </div>
          <form className="admin-form" onSubmit={(e) => void createTeam(e)}>
            <label>
              Name
              <input
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                rows={3}
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
              />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              Create team
            </button>
          </form>
        </section>

        <section className="panel admin-panel">
          <div className="admin-section-head">
            <h2>Edit team</h2>
          </div>
          {!selected ? (
            <p className="empty">Select a team to edit.</p>
          ) : (
            <form className="admin-form" onSubmit={(e) => void saveTeam(e)}>
              <label>
                Name
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <fieldset className="role-fieldset">
                <legend>Members (Team Member role only)</legend>
                {teamMembers.length === 0 ? (
                  <p className="meta">
                    No users have the Team Member role yet. Assign it under
                    Manage users.
                  </p>
                ) : (
                  teamMembers.map((user) => (
                    <label key={user.id} className="check-row">
                      <input
                        type="checkbox"
                        checked={memberIds.includes(user.id)}
                        onChange={() => toggleMember(user.id)}
                      />
                      {user.name || user.email}
                    </label>
                  ))
                )}
              </fieldset>
              <div className="admin-actions">
                <button className="btn" type="submit" disabled={busy}>
                  Save team
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void removeTeam()}
                >
                  Delete team
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
