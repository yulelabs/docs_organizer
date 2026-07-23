import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LANGUAGE,
  type AppLanguage,
  type UserRecord,
} from "@docs-organizer/shared";
import { api } from "../api";
import { en, pt, type MessageKey } from "./messages";

const GUEST_LANG_KEY = "docs_organizer_guest_lang";

const dictionaries: Record<AppLanguage, Record<MessageKey, string>> = {
  pt,
  en,
};

function readGuestLanguage(): AppLanguage {
  try {
    const value = sessionStorage.getItem(GUEST_LANG_KEY);
    if (value === "en" || value === "pt") return value;
  } catch {
    // ignore
  }
  return DEFAULT_LANGUAGE;
}

function writeGuestLanguage(language: AppLanguage) {
  try {
    sessionStorage.setItem(GUEST_LANG_KEY, language);
  } catch {
    // ignore
  }
}

export function getGuestLanguage(): AppLanguage {
  return readGuestLanguage();
}

type I18nContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  isLoggedIn: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider(props: {
  user: UserRecord | null;
  onUserUpdated?: (user: UserRecord) => void;
  children: ReactNode;
}) {
  const [guestLanguage, setGuestLanguage] = useState<AppLanguage>(() =>
    readGuestLanguage(),
  );
  const [saving, setSaving] = useState(false);

  const language: AppLanguage = props.user
    ? props.user.preferredLanguage || DEFAULT_LANGUAGE
    : guestLanguage;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => {
      let text = dictionaries[language][key] ?? dictionaries.pt[key] ?? key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
    [language],
  );

  const setLanguage = useCallback(
    async (next: AppLanguage) => {
      if (props.user) {
        if (props.user.preferredLanguage === next || saving) return;
        setSaving(true);
        try {
          const result = await api.updatePreferences({ preferredLanguage: next });
          props.onUserUpdated?.(result.user);
        } finally {
          setSaving(false);
        }
        return;
      }
      writeGuestLanguage(next);
      setGuestLanguage(next);
    },
    [props.user, props.onUserUpdated, saving],
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      isLoggedIn: Boolean(props.user),
    }),
    [language, setLanguage, t, props.user],
  );

  return createElement(I18nContext.Provider, { value }, props.children);
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function LanguageSwitcher(props: { className?: string }) {
  const { language, setLanguage, t, isLoggedIn } = useI18n();
  const [busy, setBusy] = useState(false);

  async function change(next: AppLanguage) {
    if (next === language) return;
    setBusy(true);
    try {
      await setLanguage(next);
    } catch (err) {
      console.warn("[docs-organizer i18n] Failed to save language", err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`lang-switcher ${props.className ?? ""}`.trim()}>
      <label className="lang-switcher-label">
        <span>{t("language")}</span>
        <select
          value={language}
          disabled={busy}
          onChange={(e) => void change(e.target.value as AppLanguage)}
          aria-label={t("language")}
        >
          <option value="pt">{t("languagePt")}</option>
          <option value="en">{t("languageEn")}</option>
        </select>
      </label>
      <p className="lang-hint">
        {isLoggedIn ? t("languageHintUser") : t("languageHintGuest")}
      </p>
    </div>
  );
}
