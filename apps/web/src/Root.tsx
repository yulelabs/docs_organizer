import { useEffect, useState } from "react";
import type { UserRecord } from "@docs-organizer/shared";
import { api, getStoredToken, setStoredToken } from "./api";
import { App } from "./App";
import { AuthScreen } from "./AuthScreen";

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

export function Root() {
  const [user, setUser] = useState<UserRecord | null>(null);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const { token, error } = consumeOAuthCallback();
    if (token) setStoredToken(token);
    if (error) setAuthError(error);

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

  async function logout() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
  }

  if (booting) {
    return (
      <div className="auth-shell">
        <p className="auth-hint">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        initialError={authError}
        onAuthenticated={(nextUser, token) => {
          setStoredToken(token);
          setUser(nextUser);
          setAuthError(null);
        }}
      />
    );
  }

  return <App user={user} onLogout={() => void logout()} />;
}
