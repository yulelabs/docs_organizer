import { useEffect, useState } from "react";
import { isSuperUser, type UserRecord } from "@docs-organizer/shared";
import { api, getStoredToken, setStoredToken } from "./api";
import { AdminTeamsPage } from "./AdminTeamsPage";
import { AdminUsersPage } from "./AdminUsersPage";
import { App } from "./App";
import { AuthScreen } from "./AuthScreen";
import { I18nProvider, useI18n } from "./i18n/I18nProvider";

type AppView = "archive" | "admin-users" | "admin-teams";

function consumeOAuthCallback(): { token: string | null; error: string | null } {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("authToken");
  const error = url.searchParams.get("authError");
  if (token || error) {
    url.searchParams.delete("authToken");
    url.searchParams.delete("authError");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }
  return { token, error };
}

function viewFromHash(): AppView {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "/admin/users") return "admin-users";
  if (hash === "/admin/teams") return "admin-teams";
  return "archive";
}

function BootShell() {
  const { t } = useI18n();
  return (
    <div className="auth-shell">
      <p className="auth-hint">{t("loading")}</p>
    </div>
  );
}

function AuthenticatedApp(props: {
  user: UserRecord;
  setUser: (user: UserRecord | null) => void;
}) {
  const [view, setView] = useState<AppView>(() => viewFromHash());

  useEffect(() => {
    function onHashChange() {
      setView(viewFromHash());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(next: AppView) {
    const hash =
      next === "admin-users"
        ? "#/admin/users"
        : next === "admin-teams"
          ? "#/admin/teams"
          : "#/";
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      setView(next);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setStoredToken(null);
    props.setUser(null);
    navigate("archive");
  }

  if (view === "admin-users") {
    if (!isSuperUser(props.user)) {
      navigate("archive");
      return null;
    }
    return (
      <AdminUsersPage
        currentUser={props.user}
        onBack={() => navigate("archive")}
      />
    );
  }

  if (view === "admin-teams") {
    if (!isSuperUser(props.user)) {
      navigate("archive");
      return null;
    }
    return (
      <AdminTeamsPage
        currentUser={props.user}
        onBack={() => navigate("archive")}
      />
    );
  }

  return (
    <App
      user={props.user}
      onLogout={() => void logout()}
      onOpenUsers={() => navigate("admin-users")}
      onOpenTeams={() => navigate("admin-teams")}
    />
  );
}

export function Root() {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const { token, error } = consumeOAuthCallback();
    if (token) setStoredToken(token);
    if (error) {
      console.warn(
        `[docs-organizer auth] Social login failed (${error}). Email/password sign-in still works.`,
      );
      setAuthError(error);
    }

    const existing = token || getStoredToken();
    if (!existing) {
      setBooting(false);
      return;
    }

    api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => {
        setStoredToken(null);
        setUser(null);
      })
      .finally(() => setBooting(false));
  }, []);

  return (
    <I18nProvider user={user} onUserUpdated={setUser}>
      {booting ? (
        <BootShell />
      ) : !user ? (
        <AuthScreen
          initialError={authError}
          onAuthenticated={(nextUser, token) => {
            setStoredToken(token);
            setUser(nextUser);
            setAuthError(null);
          }}
        />
      ) : (
        <AuthenticatedApp user={user} setUser={setUser} />
      )}
    </I18nProvider>
  );
}
