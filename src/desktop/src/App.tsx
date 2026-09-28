import { useEffect, useState } from "react";
import { desktopApi } from "./lib/api";
import { Library } from "./screens/Library";
import { NotebookWorkspace } from "./screens/NotebookWorkspace";
import { Settings } from "./screens/Settings";

/** Minimal hash routing: '' → library, '#/nb/<id>' → workspace,
 *  '#/settings' → settings. Real routing with dynamic ids, no Next server
 *  in the package (plan phase 4). */
function useHashRoute():
  | { name: "library" }
  | { name: "notebook"; id: string }
  | { name: "settings" } {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  if (hash === "#/settings") return { name: "settings" };
  const match = /^#\/nb\/(.+)$/.exec(hash);
  if (match) return { name: "notebook", id: decodeURIComponent(match[1]) };
  return { name: "library" };
}

export function App() {
  const route = useHashRoute();
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        className="rule-top"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--space-2) var(--space-4)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <button
          onClick={() => (window.location.hash = "")}
          style={{ border: "none", padding: 0, fontWeight: 700, letterSpacing: "0.04em" }}
          aria-label="Zur Bibliothek"
        >
          note-lm
        </button>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <a
            href="#/settings"
            className="mono"
            style={{ textDecoration: "none", color: "inherit" }}
            aria-label="Einstellungen"
          >
            Einstellungen
          </a>
          <StatusBadge />
        </div>
      </header>
      <main style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {route.name === "library" ? (
          <Library />
        ) : route.name === "settings" ? (
          <Settings />
        ) : (
          <NotebookWorkspace key={route.id} notebookId={route.id} />
        )}
      </main>
    </div>
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
    <span className="mono" title="Wo wird verarbeitet">
      ◉ {state}
    </span>
  );
}
