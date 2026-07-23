import { useEffect, useState } from "react";
import type { OAuthProvider, UserRecord } from "@docs-organizer/shared";
import { api, setStoredToken } from "./api";

type Mode = "login" | "register";

function warnOAuthIssues(warnings: string[] | undefined) {
  if (!warnings?.length) return;
  for (const warning of warnings) {
    console.warn(`[docs-organizer auth] ${warning}`);
  }
}

export function AuthScreen(props: {
  onAuthenticated: (user: UserRecord, token: string) => void;
  initialError?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(props.initialError ?? null);
  const [oauth, setOauth] = useState<OAuthProvider[]>([]);

  useEffect(() => {
    api
      .getProviders()
      .then((data) => {
        setOauth(data.oauth ?? []);
        warnOAuthIssues(data.warnings);
      })
      .catch((err) => {
        setOauth([]);
        console.warn(
          "[docs-organizer auth] Could not load auth providers; email/password still available.",
          err,
        );
      });
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await api.login({ email, password })
          : await api.register({ email, password, name: name || undefined });
      setStoredToken(result.token);
      props.onAuthenticated(result.user, result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <h1>Docs Organizer</h1>
          <p>Sign in to open your private invoice archive. Your documents stay visible only to you.</p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            Create account
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <form className="auth-form" onSubmit={(e) => void submit(e)}>
          {mode === "register" ? (
            <label>
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional"
                autoComplete="name"
              />
            </label>
          ) : null}
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        {oauth.length > 0 ? (
          <div className="oauth-block">
            <p className="oauth-divider">or continue with</p>
            <div className="oauth-buttons">
              {oauth.map((provider) => (
                <a
                  key={provider}
                  className={`btn btn-secondary oauth-${provider}`}
                  href={api.oauthUrl(provider)}
                >
                  {provider === "google"
                    ? "Google"
                    : provider === "facebook"
                      ? "Facebook"
                      : "GitHub"}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
