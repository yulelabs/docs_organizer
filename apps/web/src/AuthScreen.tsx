import { useEffect, useState } from "react";
import type { OAuthProvider, UserRecord } from "@docs-organizer/shared";
import { api, setStoredToken } from "./api";
import { getGuestLanguage, LanguageSwitcher, useI18n } from "./i18n/I18nProvider";

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
  const { t } = useI18n();
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
      const preferredLanguage = getGuestLanguage();
      const result =
        mode === "login"
          ? await api.login({ email, password })
          : await api.register({
              email,
              password,
              name: name || undefined,
              preferredLanguage,
            });
      setStoredToken(result.token);
      props.onAuthenticated(result.user, result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("authFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-panel">
        <div className="auth-brand">
          <h1>{t("brandName")}</h1>
          <p>{t("authTagline")}</p>
        </div>

        <LanguageSwitcher />

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            {t("signIn")}
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            {t("createAccount")}
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <form className="auth-form" onSubmit={(e) => void submit(e)}>
          {mode === "register" ? (
            <label>
              {t("name")}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("nameOptional")}
                autoComplete="name"
              />
            </label>
          ) : null}
          <label>
            {t("email")}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label>
            {t("password")}
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
              ? t("pleaseWait")
              : mode === "login"
                ? t("signIn")
                : t("createAccount")}
          </button>
        </form>

        {oauth.length > 0 ? (
          <div className="oauth-block">
            <p className="oauth-divider">{t("orContinueWith")}</p>
            <div className="oauth-buttons">
              {oauth.map((provider) => (
                <a
                  key={provider}
                  className={`btn btn-secondary oauth-${provider}`}
                  href={api.oauthUrl(provider)}
                >
                  {provider === "google"
                    ? t("continueGoogle")
                    : provider === "facebook"
                      ? t("continueFacebook")
                      : t("continueGitHub")}
                </a>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
