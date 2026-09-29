/**
 * In-app evidence reader (delivery mandate P2): clicking an anchor chip opens
 * this panel instead of jumping straight to the external viewer. Modal, styled
 * after CloseDialog: backdrop + surface card. The anchor (from claims.list)
 * carries the display fields; evidence.open is fetched to resolve the stored
 * absolute path for "Extern oeffnen" - only an actually existing file enables
 * the button, never a fabricated path.
 */
import { useEffect, useState } from "react";
import { desktopApi, openExternalFile, type ClaimAnchorView } from "../lib/api";

/** German mm:ss for a time-range locator; minutes may exceed 59 - honest, no
 * hour rollover. Exported: the anchor chips render the same locator text. */
export function formatTimeRange(locator: { startSec: number; endSec: number | null }): string {
  const mmss = (sec: number): string => {
    const whole = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  };
  return `${mmss(locator.startSec)}-${locator.endSec == null ? "?" : mmss(locator.endSec)}`;
}

export function EvidencePanel({ anchor, onClose }: { anchor: ClaimAnchorView; onClose: () => void }) {
  // evidence.open resolves the stored path once per opened anchor
  const [ref, setRef] = useState<{ absolutePath: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let alive = true;
    setRef(null);
    setError(null);
    desktopApi
      .openEvidence(anchor.id)
      .then((r) => {
        if (alive) setRef(r);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [anchor.id]);

  const openExternally = async () => {
    if (!ref?.absolutePath) return;
    setOpening(true);
    try {
      await openExternalFile(ref.absolutePath);
    } finally {
      setOpening(false);
    }
  };

  const hasLocator = anchor.page != null || anchor.locator != null;
  const place = anchor.locator
    ? formatTimeRange(anchor.locator)
    : anchor.page != null
      ? `S. ${anchor.page}`
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-panel-title"
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
          maxWidth: 520,
          width: "calc(100vw - 48px)",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 40px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <h2 id="evidence-panel-title" style={{ margin: 0, fontSize: "1.05rem" }}>
          Beleg: {anchor.fileName ?? "Quelle"}
          {` · v${anchor.version}`}
        </h2>
        <span className="mono muted">{place ?? "ohne Ort"}</span>
        {!hasLocator && (
          <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
            Kein zuverlässiger Ort gespeichert - nur Zitat
          </p>
        )}
        <blockquote
          style={{
            margin: "var(--space-2) 0",
            padding: "0 0 0 var(--space-3)",
            borderLeft: "3px solid var(--accent-soft)",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: "1.05rem",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {anchor.quote}
        </blockquote>
        {error && (
          <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{error}</p>
        )}
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            className="primary"
            disabled={!ref?.absolutePath || opening}
            title={!ref?.absolutePath ? "Originaldatei nicht verfügbar" : undefined}
            onClick={openExternally}
          >
            Extern öffnen
          </button>
          <button onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}
