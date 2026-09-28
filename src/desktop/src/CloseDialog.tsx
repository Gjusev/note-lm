import { useEffect, useState } from "react";

/** The withGlobalTauri bridge, or null outside the Tauri window (dev). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tauri(): any | null {
  return "__TAURI__" in window ? (window as any).__TAURI__ : null;
}

/**
 * Close-with-active-work dialog (desktop-workers-plan "Cierre, bandeja").
 * Rust intercepts CloseRequested while the engine reports active jobs and
 * asks the UI, which offers three outcomes: keep working in the tray, pause
 * the scheduler and quit, or stay open. Without active work Rust closes the
 * window directly — unchanged behavior.
 */
export function CloseDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = tauri();
    if (!t) return; // browser dev: no close interception
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    t.event.listen("close-requested", () => setOpen(true)).then((off: () => void) => {
      if (cancelled) off();
      else unlisten = off;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!open) return null;

  // Hide to tray: work continues; the tray menu brings the window back.
  const hideToTray = async () => {
    setBusy(true);
    try {
      await tauri()?.core.invoke("hide_to_tray");
    } finally {
      setOpen(false);
      setBusy(false);
    }
  };

  // Quit path: the engine persists scheduler.paused, the run-loop teardown
  // kills the engine child — no hidden processes survive a real exit.
  const pauseAndExit = async () => {
    setBusy(true);
    try {
      await tauri()?.core.invoke("pause_and_exit");
    } catch {
      // exit is in flight; nothing to recover here
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: "var(--radius)",
          padding: "var(--space-6)",
          maxWidth: 440,
          boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
        }}
      >
        <h2 id="close-dialog-title" style={{ margin: 0, fontSize: "1.05rem" }}>
          note-lm beenden?
        </h2>
        <p style={{ margin: "var(--space-2) 0 var(--space-4)", color: "var(--ink-60)" }}>
          Es laufen gerade Aufgaben. Sie können im Hintergrund weiterlaufen oder pausiert werden.
        </p>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <button className="primary" disabled={busy} onClick={hideToTray}>
            Weiter im Hintergrund
          </button>
          <button disabled={busy} onClick={pauseAndExit}>
            Pausieren und beenden
          </button>
          <button disabled={busy} onClick={() => setOpen(false)}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
