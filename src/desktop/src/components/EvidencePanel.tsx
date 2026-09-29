/**
 * Evidence views shared by the center reader and the inspector (workspace
 * redesign phase 1). The old modal EvidencePanel is gone: its PDF/media
 * rendering moved into the center DocumentWorkspace and its quote/locator/
 * status text into the EvidenceInspector - one viewer, no disconnected
 * second surface. Dialog semantics (the modal's a11y work) live on in the
 * narrow-window overlay panels of WorkspaceShell.
 *
 * Remaining here: locator formatting and the media excerpt player. PDF page
 * rendering lives in workspace/SourceReader.tsx (canvas + text layer +
 * selection capture).
 */
/** German mm:ss for a time-range locator; minutes may exceed 59 - honest, no
 * hour rollover. Exported: anchor chips render the same locator text. */
export function formatTimeRange(locator: { startSec: number; endSec: number | null }): string {
  const mmss = (sec: number): string => {
    const whole = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  };
  return `${mmss(locator.startSec)}-${locator.endSec == null ? "?" : mmss(locator.endSec)}`;
}

/** Media kind of an evidence file. EvidenceRef/anchor carry no MIME type, so
 *  the extension decides - mirroring the ext->type table the importer used. */
export function mediaKind(fileName: string | null): "audio" | "video" | null {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? "";
  if (["mp3", "wav", "m4a", "aac", "ogg", "opus"].includes(ext)) return "audio";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  return null;
}

/** PDF detection by extension (the stored path is files/<uuid><ext>). */
export function isPdf(fileName: string | null, path: string): boolean {
  const ext = fileName?.split(".").pop()?.toLowerCase() ?? path.split(".").pop()?.toLowerCase() ?? "";
  return ext === "pdf";
}

/** Inline media excerpt: <audio>/<video controls> served from the stored
 *  original over the asset protocol. Seeks to startSec once metadata is in;
 *  a present endSec pauses playback - the honest excerpt boundary. Used by
 *  the center reader for sources opened via a media anchor. */
export function MediaView({ src, kind, locator }: {
  src: string; kind: "audio" | "video"; locator: { startSec: number; endSec: number | null };
}) {
  const seekAndClamp = (e: { currentTarget: HTMLMediaElement }) => {
    const el = e.currentTarget;
    if (el.currentTime < locator.startSec) el.currentTime = locator.startSec;
  };
  const clamp = (e: { currentTarget: HTMLMediaElement }) => {
    if (locator.endSec != null && e.currentTarget.currentTime >= locator.endSec) e.currentTarget.pause();
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {kind === "audio" ? (
        <audio controls preload="metadata" src={src} onLoadedMetadata={seekAndClamp} onTimeUpdate={clamp} />
      ) : (
        <video
          controls preload="metadata" src={src}
          style={{ maxWidth: "100%", width: "100%" }}
          onLoadedMetadata={seekAndClamp} onTimeUpdate={clamp}
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
