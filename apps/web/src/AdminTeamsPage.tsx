import { useEffect, useMemo, useState } from "react";
import type {
  AdminUserRecord,
  TeamRecord,
  UserRecord,
} from "@docs-organizer/shared";
import { api } from "./api";
import { LanguageSwitcher, useI18n } from "./i18n/I18nProvider";

export function AdminTeamsPage(props: {
  currentUser: UserRecord;
  onBack: () => void;
}) {
  const { t } = useI18n();
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
      setError(err instanceof Error ? err.message : t("loadTeamsFailed")),
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
      setError(err instanceof Error ? err.message : t("createFailed"));
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
      setError(err instanceof Error ? err.message : t("updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function removeTeam() {
    if (!selected) return;
    if (!window.confirm(t("deleteTeamConfirm", { name: selected.name }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminDeleteTeam(selected.id);
      setSelectedId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("deleteFailed"));
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
          <h1>{t("adminTeamsTitle")}</h1>
          <p>{t("adminTeamsSubtitle")}</p>
        </div>
        <div className="top-actions">
          <LanguageSwitcher className="lang-switcher-compact" />
          <button className="btn btn-secondary" type="button" onClick={props.onBack}>
            {t("backToArchive")}
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="admin-layout">
        <section className="panel admin-panel">
          <div className="admin-section-head">
            <h2>{t("teams")}</h2>
            <span className="meta">{t("totalCount", { count: teams.length })}</span>
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
                    {team.memberIds.length === 1
                      ? t("memberCount", { count: team.memberIds.length })
                      : t("memberCountPlural", { count: team.memberIds.length })}
                  </div>
                </div>
              </li>
            ))}
            {teams.length === 0 ? (
              <li className="empty">{t("noTeamsYet")}</li>
            ) : null}
          </ul>
        </section>

        <section className="panel admin-panel">
          <div className="admin-section-head">
            <h2>{t("createTeam")}</h2>
          </div>
          <form className="admin-form" onSubmit={(e) => void createTeam(e)}>
            <label>
              {t("name")}
              <input
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </label>
            <label>
              {t("description")}
              <textarea
                rows={3}
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
              />
            </label>
            <button className="btn" type="submit" disabled={busy}>
              {t("createTeam")}
            </button>
          </form>
        </section>

        <section className="panel admin-panel">
          <div className="admin-section-head">
            <h2>{t("editTeam")}</h2>
          </div>
          {!selected ? (
            <p className="empty">{t("selectTeam")}</p>
          ) : (
            <form className="admin-form" onSubmit={(e) => void saveTeam(e)}>
              <label>
                {t("name")}
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                {t("description")}
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <fieldset className="role-fieldset">
                <legend>{t("membersTeamOnly")}</legend>
                {teamMembers.length === 0 ? (
                  <p className="meta">
                    {t("noTeamMembersYet")}
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
                  {t("saveTeam")}
                </button>
                <button
                  className="btn btn-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => void removeTeam()}
                >
                  {t("deleteTeam")}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
