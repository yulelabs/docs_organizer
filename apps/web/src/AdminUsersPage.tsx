import { useEffect, useMemo, useState } from "react";
import {
  ROLE_LABELS,
  type AdminUserRecord,
  type RoleSlug,
  type UserRecord,
} from "@docs-organizer/shared";
import { api } from "./api";

const ALL_ROLES: RoleSlug[] = ["user", "super_user", "team_member"];

export function AdminUsersPage(props: {
  currentUser: UserRecord;
  onBack: () => void;
}) {
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createName, setCreateName] = useState("");
  const [createRoles, setCreateRoles] = useState<RoleSlug[]>(["user"]);

  const selected = useMemo(
    () => users.find((u) => u.id === selectedId) ?? null,
    [users, selectedId],
  );

  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editRoles, setEditRoles] = useState<RoleSlug[]>(["user"]);
  const [resetPassword, setResetPassword] = useState("");

  async function refresh() {
    const data = await api.adminListUsers();
    setUsers(data.users);
  }

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load users"),
    );
  }, []);

  useEffect(() => {
    if (!selected) return;
    setEditEmail(selected.email);
    setEditName(selected.name ?? "");
    setEditRoles(selected.roles.length ? selected.roles : ["user"]);
    setResetPassword("");
  }, [selected]);

  function toggleRole(list: RoleSlug[], role: RoleSlug): RoleSlug[] {
    if (role === "user") return list.includes("user") ? list : [...list, "user"];
    return list.includes(role)
      ? list.filter((r) => r !== role)
      : [...list, role];
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.adminCreateUser({
        email: createEmail,
        password: createPassword,
        name: createName || undefined,
        roles: createRoles,
      });
      setCreateEmail("");
      setCreatePassword("");
      setCreateName("");
      setCreateRoles(["user"]);
      await refresh();
      setSelectedId(created.user.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.adminUpdateUser(selected.id, {
        email: editEmail,
        name: editName || null,
      });
      await api.adminSetRoles(selected.id, editRoles);
      if (resetPassword.trim()) {
        await api.adminResetPassword(selected.id, resetPassword.trim());
        setResetPassword("");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <h1>Manage users</h1>
          <p>Create accounts, assign roles, and reset passwords.</p>
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
            <h2>Users</h2>
            <span className="meta">{users.length} total</span>
          </div>
          <ul className="doc-list">
            {users.map((user) => (
              <li
                key={user.id}
                className={`doc-item${selectedId === user.id ? " selected" : ""}`}
                onClick={() => setSelectedId(user.id)}
              >
                <div>
                  <strong>{user.name || user.email}</strong>
                  <div className="meta">{user.email}</div>
                </div>
                <div className="role-chips">
                  {user.roles.map((role) => (
                    <span key={role} className="chip">
                      {ROLE_LABELS[role]}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel admin-panel">
          <div className="admin-section-head">
            <h2>Create user</h2>
          </div>
          <form className="admin-form" onSubmit={(e) => void createUser(e)}>
            <label>
              Name
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              Email
              <input
                type="email"
                required
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                minLength={8}
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
              />
            </label>
            <fieldset className="role-fieldset">
              <legend>Roles</legend>
              {ALL_ROLES.map((role) => (
                <label key={role} className="check-row">
                  <input
                    type="checkbox"
                    checked={createRoles.includes(role)}
                    disabled={role === "user"}
                    onChange={() =>
                      setCreateRoles((prev) => toggleRole(prev, role))
                    }
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </fieldset>
            <button className="btn" type="submit" disabled={busy}>
              Create user
            </button>
          </form>
        </section>

        <section className="panel admin-panel">
          <div className="admin-section-head">
            <h2>Edit user</h2>
          </div>
          {!selected ? (
            <p className="empty">Select a user to edit.</p>
          ) : (
            <form className="admin-form" onSubmit={(e) => void saveDetails(e)}>
              <label>
                Name
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  required
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </label>
              <fieldset className="role-fieldset">
                <legend>Roles</legend>
                {ALL_ROLES.map((role) => (
                  <label key={role} className="check-row">
                    <input
                      type="checkbox"
                      checked={editRoles.includes(role)}
                      disabled={
                        role === "user" ||
                        (role === "super_user" &&
                          selected.id === props.currentUser.id &&
                          selected.roles.includes("super_user"))
                      }
                      onChange={() =>
                        setEditRoles((prev) => toggleRole(prev, role))
                      }
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </fieldset>
              <label>
                Reset password
                <input
                  type="password"
                  minLength={8}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Leave blank to keep current"
                  autoComplete="new-password"
                />
              </label>
              <button className="btn" type="submit" disabled={busy}>
                Save changes
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
