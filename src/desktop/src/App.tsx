import { useEffect, useState } from "react";
import { desktopApi } from "./lib/api";
import { useTheme, type ThemeSetting } from "./lib/uiState";
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
          aria-label="Zur Bibliothek"
        >
          <BrandMark />
          <span>note-lm</span>
        </button>
        <div className="app-actions" style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <a
            href="#/activity"
            className="mono"
            style={{ textDecoration: "none", color: "inherit" }}
            aria-label="Aktivität"
          >
            Aktivität
          </a>
          <a
            href="#/settings"
            className="mono"
            style={{ textDecoration: "none", color: "inherit" }}
            aria-label="Einstellungen"
          >
            Einstellungen
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
      <path d="M19 4v5h5" fill="#f6f4f0" opacity="0.9" />
      <path d="M12 13h8M12 17h6" stroke="#f6f4f0" strokeWidth="2" strokeLinecap="round" />
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
      Design
      <select
        value={theme.setting}
        onChange={(e) => theme.set(e.target.value as ThemeSetting)}
        aria-label="Design wählen (Hell, Dunkel oder System)"
        style={{ width: "auto", padding: "0 var(--space-2)" }}
      >
        <option value="light">Hell</option>
        <option value="dark">Dunkel</option>
        <option value="system">System</option>
      </select>
    </label>
  );
}

function StatusBadge() {
  const [state, setState] = useState<string>("…");
  useEffect(() => {
    desktopApi
      .diagnostics()
      .then((d) =>
        setState(
          d.localChatConfigured
            ? "Auf diesem Computer"
            : d.vecVersion
              ? "Lokal · KI nicht konfiguriert"
              : "Textsuche"
        )
      )
      .catch(() => setState("Motor nicht erreichbar"));
  }, []);
  return (
    <span className="chip status-badge" title="Wo wird verarbeitet"
      style={{ background: "var(--chip-neutral-bg)", color: "var(--chip-neutral-fg)" }}>
      ◉ {state}
    </span>
  );
}
