import { useEffect, useState } from "react";
import { desktopApi } from "./lib/api";
import { useTheme, type ThemeSetting } from "./lib/uiState";
import { t, useLang } from "./i18n";
import { CloseDialog } from "./CloseDialog";
import { Onboarding } from "./Onboarding";
import { Library } from "./screens/Library";
import { NotebookWorkspace } from "./screens/NotebookWorkspace";
import { Settings } from "./screens/Settings";
import { Activity } from "./screens/Activity";

/** Minimal hash routing: '' → library, '#/nb/<id>' → workspace,
 *  '#/settings' → settings. Real routing with dynamic ids, no Next server
 *  in the package (plan phase 4). */
function useHashRoute():
  | { name: "library" }
  | { name: "notebook"; id: string }
  | { name: "settings" }
  | { name: "activity" } {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  if (hash === "#/settings") return { name: "settings" };
  if (hash === "#/activity") return { name: "activity" };
  const match = /^#\/nb\/(.+)$/.exec(hash);
  if (match) return { name: "notebook", id: decodeURIComponent(match[1]) };
  return { name: "library" };
}

export function App() {
  const route = useHashRoute();
  // One language subscription re-renders the whole tree on switch (nothing
  // below is memoized, so every t() call picks up the new dictionary).
  useLang();
  return (
    <div className="app-frame" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        className="rule-top app-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-2) var(--space-4)",
          borderBottom: "var(--rule-structural)",
        }}
      >
        <button
          onClick={() => (window.location.hash = "")}
          className="brand-button"
          aria-label={t("app.toLibrary")}
        >
          <BrandMark />
          <span>note-lm</span>
        </button>
        <div className="app-actions" style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <a
            href="#/activity"
            className="mono"
            style={{ textDecoration: "none", color: "inherit" }}
            aria-label={t("app.activity")}
          >
            {t("app.activity")}
          </a>
          <a
            href="#/settings"
            className="mono"
            style={{ textDecoration: "none", color: "inherit" }}
            aria-label={t("app.settings")}
          >
            {t("app.settings")}
          </a>
          <ThemeSelect />
          <StatusBadge />
        </div>
      </header>
      <main style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {route.name === "library" ? (
          <Library />
        ) : route.name === "settings" ? (
          <Settings />
        ) : route.name === "activity" ? (
          <Activity />
        ) : (
          <NotebookWorkspace key={route.id} notebookId={route.id} />
        )}
      </main>
      <CloseDialog />
      <Onboarding />
    </div>
  );
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 4h11l5 5v17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V4Z" fill="currentColor" />
      <path d="M19 4v5h5" fill="var(--paper)" opacity="0.9" />
      <path d="M12 13h8M12 17h6" stroke="var(--paper)" strokeWidth="2" strokeLinecap="round" />
      <rect x="17" y="21" width="4" height="4" rx="1" fill="var(--accent)" />
    </svg>
  );
}

/** Explicit, persisted theme selection (light/dark/system). The resolved
 *  theme lands on <html data-theme> via lib/uiState. */
function ThemeSelect() {
  const theme = useTheme();
  return (
    <label className="mono theme-select" style={{ display: "flex", gap: "var(--space-1)", alignItems: "center", fontSize: "0.72rem" }}>
      {t("app.theme")}
      <select
        value={theme.setting}
        onChange={(e) => theme.set(e.target.value as ThemeSetting)}
        aria-label={t("app.themeAria")}
        style={{ width: "auto", padding: "0 var(--space-2)" }}
      >
        <option value="light">{t("app.themeLight")}</option>
        <option value="dark">{t("app.themeDark")}</option>
        <option value="system">{t("app.themeSystem")}</option>
      </select>
    </label>
  );
}

/** Engine status badge. The state is stored as a KEY (not text) so a live
 *  language switch re-renders the label. */
type BadgeState = "checking" | "local" | "localNoAi" | "textOnly" | "down";

function StatusBadge() {
  const [state, setState] = useState<BadgeState>("checking");
  useEffect(() => {
    desktopApi
      .diagnostics()
      .then((d) =>
        setState(
          d.localChatConfigured
            ? "local"
            : d.vecVersion
              ? "localNoAi"
              : "textOnly"
        )
      )
      .catch(() => setState("down"));
  }, []);
  const label =
    state === "local" ? t("app.status.local")
      : state === "localNoAi" ? t("app.status.localNoAi")
        : state === "textOnly" ? t("app.status.textOnly")
          : state === "down" ? t("app.status.engineDown")
            : "…";
  return (
    <span className="chip status-badge" title={t("app.statusWhere")}
      style={{ background: "var(--chip-neutral-bg)", color: "var(--chip-neutral-fg)" }}>
      ◉ {label}
    </span>
  );
}
