/**
 * In-app evidence reader (delivery mandate P2): clicking an anchor chip opens
 * this panel instead of jumping straight to the external viewer. Modal, styled
 * after CloseDialog: backdrop + surface card. The anchor (from claims.list)
 * carries the display chips; evidence.open is fetched to resolve the stored
 * absolute path so the panel renders the ACTUAL page or media position from
 * the stored original - not just the quote.
 *
 * Render paths, chosen from anchor + evidence.open data:
 * - page != null and a PDF: pdf.js renders that page of the stored original
 *   (file served over the Tauri asset protocol; worker bundled via ?url).
 * - locator + audio/video file: inline player seeks to startSec; a present
 *   endSec pauses playback - the honest excerpt, not the whole file.
 * - otherwise (unknown page, browser dev, missing file): quote-only + note.
 * Failures surface as German text in the panel, never a blank frame.
 */
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { assetUrl, desktopApi, openExternalFile, type ClaimAnchorView, type EvidenceRef } from "../lib/api";
// Bundled worker: Vite emits the file into dist and hands out the hashed URL
// (?url). Same-origin asset, so CSP script-src 'self' allows it - no CDN.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** German mm:ss for a time-range locator; minutes may exceed 59 - honest, no
 * hour rollover. Exported: the anchor chips render the same locator text. */
export function formatTimeRange(locator: { startSec: number; endSec: number | null }): string {
  const mmss = (sec: number): string => {
    const whole = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  };
  return `${mmss(locator.startSec)}-${locator.endSec == null ? "?" : mmss(locator.endSec)}`;
}

/** Media kind of an evidence file. EvidenceRef carries no MIME type, so the
 *  extension decides - mirroring the ext->type table the importer used. */
function mediaKind(fileName: string | null): "audio" | "video" | null {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? "";
  if (["mp3", "wav", "m4a", "aac", "ogg", "opus"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  return null;
}

/** PDF detection by extension: the anchor stores no content type and the
 *  stored path is files/<uuid><ext>, so the original file name decides. */
function isPdf(fileName: string | null, path: string): boolean {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? path.split(".").pop()?.toLowerCase() ?? "";
  return ext === "pdf";
}

/** One rendered PDF page of the stored original via pdf.js. The worker is the
 *  bundled asset (workerUrl); the canvas scales to the panel width in device
 *  pixels, CSS width back to panel px. Load, decode and missing-file failures
 *  show an honest German error - never a blank frame. */
function PdfPageView({ src, page }: { src: string; page: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let alive = true;
    let task: RenderTask | null = null;
    let doc: PDFDocumentProxy | null = null;
    setState("loading");
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const loaded = await pdfjs.getDocument({ url: src }).promise;
        if (!alive) {
          void loaded.destroy();
          return;
        }
        doc = loaded;
        const pdfPage = await doc.getPage(Math.max(1, page));
        if (!alive) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas 2d context unavailable");
        const base = pdfPage.getViewport({ scale: 1 });
        const cssWidth = Math.min(canvas.parentElement?.clientWidth || 440, 720);
        const viewport = pdfPage.getViewport({ scale: (cssWidth / base.width) * (window.devicePixelRatio || 1) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = "auto";
        const renderTask = pdfPage.render({ canvasContext: ctx, viewport });
        task = renderTask;
        await renderTask.promise;
        if (alive) setState("done");
      } catch {
        // pdf.js rejects with a typed exception for missing/unreadable files
        if (alive) setState("error");
        try {
          doc?.destroy();
        } catch {
          /* already destroyed */
        }
      }
    })();
    return () => {
      alive = false;
      try {
        task?.cancel();
      } catch {
        /* cancel after completion is a no-op */
      }
      try {
        doc?.destroy();
      } catch {
        /* already destroyed */
      }
    };
  }, [src, page]);

  if (state === "error") {
    return (
      <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>
        Seite konnte nicht angezeigt werden - Originaldatei fehlt oder ist beschädigt.
      </p>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        style={{
          display: state === "done" ? "block" : "none",
          maxWidth: "100%",
          border: "1px solid var(--rule)",
        }}
      />
      {state === "loading" && (
        <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>Seite wird geladen…</p>
      )}
    </div>
  );
}

/** Inline media excerpt: <audio>/<video controls> served from the stored
 *  original over the asset protocol. Seeks to startSec once metadata is in;
 *  a present endSec pauses playback - the honest excerpt boundary. */
function MediaView({ src, kind, locator }: {
  src: string; kind: "audio" | "video"; locator: { startSec: number; endSec: number | null };
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {kind === "audio" ? (
        <audio
          controls
          preload="metadata"
          src={src}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (el.currentTime < locator.startSec) el.currentTime = locator.startSec;
          }}
          onTimeUpdate={(e) => {
            if (locator.endSec != null && e.currentTarget.currentTime >= locator.endSec) {
              e.currentTarget.pause();
            }
          }}
        />
      ) : (
        <video
          controls
          preload="metadata"
          src={src}
          style={{ maxWidth: "100%", width: "100%" }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (el.currentTime < locator.startSec) el.currentTime = locator.startSec;
          }}
          onTimeUpdate={(e) => {
            if (locator.endSec != null && e.currentTarget.currentTime >= locator.endSec) {
              e.currentTarget.pause();
            }
          }}
        />
      )}
      <span className="mono muted" style={{ fontSize: "0.75rem" }}>
        Ausschnitt {formatTimeRange(locator)}
        {locator.endSec == null
          ? " - Ende offen, Wiedergabe hält nicht an"
          : " - Wiedergabe hält am Ausschnittsende an"}
      </span>
    </div>
  );
}

export function EvidencePanel({ anchor, onClose }: { anchor: ClaimAnchorView; onClose: () => void }) {
  // evidence.open resolves the stored path once per opened anchor
  const [ref, setRef] = useState<EvidenceRef | null>(null);
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
      : "ohne Ort";

  const fileUrl = ref?.absolutePath ? assetUrl(ref.absolutePath) : null;
  const kind = mediaKind(anchor.fileName);
  const pdfSrc = fileUrl && anchor.page != null && isPdf(anchor.fileName, ref?.absolutePath ?? "") ? fileUrl : null;
  const mediaSrc = fileUrl && kind && anchor.locator ? fileUrl : null;

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
        <span className="mono muted">{place}</span>
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
        {pdfSrc && <PdfPageView src={pdfSrc} page={anchor.page as number} />}
        {mediaSrc && kind && anchor.locator && (
          <MediaView src={mediaSrc} kind={kind} locator={anchor.locator} />
        )}
        {ref && !ref.absolutePath && (
          <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
            Originaldatei nicht verfügbar - nur Zitat.
          </p>
        )}
        {!fileUrl && ref?.absolutePath && (pdfSrc || mediaSrc) === null && hasLocator && (
          <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
            Ansicht im Fenster nicht verfügbar - nur Zitat (Original existiert).
          </p>
        )}
        {error && (
          <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{error}</p>
        )}
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
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
