/**
 * SourceReader (priority 1: reader + provenance): the center document
 * viewer. Opens ANY source through sources.open {sourceId, versionId?} - no
 * evidence anchor needed - and renders the stored original with the pdf.js
 * path (canvas + selectable TextLayer), the media player, a text preview or
 * a CSV preview. A version dropdown (sources.listVersions) re-opens the
 * source at any immutable version; version scope validation stays
 * engine-side, typed errors surface here in German.
 *
 * Provenance contract: every captured selection carries
 * {sourceId, versionId, version, page, quote} - the identity of the OPENED
 * version at selection time. The parent freezes that object; the save paths
 * use it verbatim, never re-resolving the version (open v1 -> select ->
 * publish v2 -> save still cites v1).
 *
 * Keyboard path (research §4A "selection with keyboard besides mouse"): the
 * pdf.js text layer is one tab stop; Arrow keys move between its text items
 * ("quote blocks" - line-level spans, a pragmatic approximation of
 * paragraphs); Enter/Space captures the focused block and opens a chooser
 * (Als Beleg speichern / In Notiz einfügen); Escape closes the chooser and
 * returns focus to the block. Mouse selection capture stays.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { assetUrl, type Source, type SourceOpenView, type SourceVersionView } from "../lib/api";
import { isPdf, mediaKind, MediaView } from "../components/EvidencePanel";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export interface ReaderSelection {
  sourceId: string;
  /** Immutable version row id captured at selection time. Null only while
   *  the version list is unresolved - a claim then binds to the latest
   *  version (engine fallback, stated in the inspector). */
  versionId: string | null;
  /** Display number of the same version, captured with the id. */
  version: number | null;
  page: number;
  quote: string;
}

/** One rendered PDF page: canvas + selectable TextLayer. Loading/decode
 *  failures surface as German text, never a blank frame. The canvas scales
 *  to the available width; text spans are laid out in CSS px so selection
 *  rectangles match the glyphs. Only ONE page is mounted at a time (sec 9:
 *  load only nearby pages, free canvases). */
function PdfPage({ src, page, onNumPages, textRef, onBlockSelect }: {
  src: string;
  page: number;
  onNumPages: (n: number) => void;
  textRef: React.RefObject<HTMLDivElement | null>;
  /** Keyboard path: Enter/Space on a focused text-layer block. */
  onBlockSelect: (quote: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let alive = true;
    let doc: import("pdfjs-dist").PDFDocumentProxy | null = null;
    setState("loading");
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const loaded = await pdfjs.getDocument({ url: src }).promise;
        if (!alive) { void loaded.destroy(); return; }
        doc = loaded;
        onNumPages(loaded.numPages);
        const pdfPage = await loaded.getPage(Math.max(1, page));
        if (!alive) return;
        const canvas = canvasRef.current;
        const textDiv = textRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !textDiv || !wrap) return;
        const parentW = wrap.parentElement?.clientWidth || 640;
        const cssW = Math.min(parentW, 760);
        const dpr = window.devicePixelRatio || 1;
        const base = pdfPage.getViewport({ scale: 1 });
        const cssScale = cssW / base.width;
        const canvasVp = pdfPage.getViewport({ scale: cssScale * dpr });
        const textVp = pdfPage.getViewport({ scale: cssScale });
        canvas.width = Math.ceil(canvasVp.width);
        canvas.height = Math.ceil(canvasVp.height);
        canvas.style.width = `${Math.round(textVp.width)}px`;
        canvas.style.height = `${Math.round(textVp.height)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas 2d context unavailable");
        // Canvas first, then the text layer on top of it.
        await pdfPage.render({ canvasContext: ctx, viewport: canvasVp }).promise;
        if (!alive) return;
        textDiv.replaceChildren();
        textDiv.style.width = `${Math.round(textVp.width)}px`;
        textDiv.style.height = `${Math.round(textVp.height)}px`;
        const tl = new pdfjs.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textDiv, viewport: textVp });
        await tl.render();
        // Keyboard path: text items become programmatically focusable blocks
        // (roving focus managed in onLayerKeyDown - one tab stop on the layer).
        for (const el of textDiv.children) {
          if (el instanceof HTMLElement && el.tagName === "SPAN") el.tabIndex = -1;
        }
        if (alive) setState("done");
      } catch {
        if (alive) setState("error");
        try { doc?.destroy(); } catch { /* already destroyed */ }
      }
    })();
    return () => {
      alive = false;
      try { doc?.destroy(); } catch { /* already destroyed */ }
    };
  }, [src, page, onNumPages, textRef]);

  /** Quote blocks = the pdf.js text items of the layer (line-level spans -
   *  a pragmatic approximation of paragraphs). Arrows rove between them,
   *  Enter/Space reports the focused block's text up as a selection. */
  const onLayerKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const layer = textRef.current;
    if (!layer) return;
    const blocks = Array.from(layer.children).filter((el): el is HTMLSpanElement => el instanceof HTMLSpanElement);
    if (blocks.length === 0) return;
    const active = document.activeElement;
    const idx = active instanceof HTMLSpanElement ? blocks.indexOf(active) : -1;
    const clamp = (i: number) => Math.max(0, Math.min(blocks.length - 1, i));
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      blocks[clamp(idx < 0 ? 0 : idx + 1)]?.focus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      blocks[clamp(idx < 0 ? blocks.length - 1 : idx - 1)]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const block = idx >= 0 ? blocks[idx] : blocks[0];
      if (block) onBlockSelect(block.textContent?.trim() ?? "");
    }
  };

  return (
    <div ref={wrapRef} style={{ width: "100%", display: "flex", justifyContent: "center", padding: "var(--space-4)" }}>
      {state === "error" ? (
        <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>
          Seite konnte nicht angezeigt werden - Originaldatei fehlt oder ist beschädigt.
        </p>
      ) : (
        <div style={{ position: "relative" }}>
          <canvas ref={canvasRef} aria-label={`Seite ${page}`} role="img"
            style={{ display: state === "done" ? "block" : "none", maxWidth: "100%", border: "1px solid var(--rule)", background: "#fff" }} />
          <div ref={textRef} className="text-layer" tabIndex={0} role="document"
            aria-label={`Seite ${page}, Textebene. Pfeiltasten bewegen zwischen Zitatblöcken, Enter übernimmt den markierten Block.`}
            onKeyDown={onLayerKeyDown}
            style={{ display: state === "done" ? "block" : "none" }} />
          {state === "loading" && <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>Seite wird geladen…</p>}
        </div>
      )}
    </div>
  );
}

/** Text preview of a stored plain-text original (txt/md): fetched over the
 *  asset protocol, capped for display. */
function TextPreview({ src }: { src: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setText(null);
    setFailed(false);
    fetch(src).then((r) => r.text()).then((t) => { if (alive) setText(t); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [src]);
  if (failed) return <p style={{ color: "var(--accent)", fontSize: "0.85rem", margin: 0 }}>Text konnte nicht geladen werden.</p>;
  if (text == null) return <p className="muted" style={{ fontSize: "0.85rem" }}>Text wird geladen…</p>;
  return (
    <div style={{ width: "100%", maxWidth: 760 }}>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", fontSize: "0.8rem", margin: 0 }}>{
        text.length > 20000 ? `${text.slice(0, 20000)}\n…` : text
      }</pre>
      {text.length > 20000 && <p className="muted" style={{ fontSize: "0.75rem" }}>Vorschau gekürzt.</p>}
    </div>
  );
}

/** CSV preview of the stored original (sidecarKind "sheet"). Naive
 *  comma/newline split - no quoted-field parsing, first 50 rows.
 *  ponytail: honest preview; add a real CSV parser when cell-true display
 *  matters (calculations already read the real rows engine-side). */
function SheetPreview({ src }: { src: string }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setRows(null);
    setFailed(false);
    fetch(src).then((r) => r.text()).then((t) => {
      if (!alive) return;
      setRows(t.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, 50).map((l) => l.split(",")));
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [src]);
  if (failed) return <p style={{ color: "var(--accent)", fontSize: "0.85rem", margin: 0 }}>Tabelle konnte nicht geladen werden.</p>;
  if (!rows) return <p className="muted" style={{ fontSize: "0.85rem" }}>Tabelle wird geladen…</p>;
  return (
    <div style={{ width: "100%", maxWidth: 900 }}>
      <div style={{ overflowX: "auto", border: "1px solid var(--rule)", borderRadius: "var(--radius)" }}>
        <table className="mono" style={{ borderCollapse: "collapse", fontSize: "0.7rem" }}>
          <tbody>
            {rows.map((cells, i) => (
              <tr key={i}>
                {cells.map((c, j) => (
                  <td key={j} style={{ border: "1px solid var(--rule)", padding: "2px var(--space-1)", whiteSpace: "nowrap" }}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: "0.75rem" }}>Vorschau - erste 50 Zeilen, Zellen ohne Spezialformatierung.</p>
    </div>
  );
}

/** The center work surface for one source: opened via sources.open, any
 *  version selectable, selections carry the opened version's identity. */
export function SourceReader(props: {
  source: Source;
  /** Immutable version row id of the opened version (null = "latest",
   *  only until the parent pins the resolved row id). */
  openVersionId: string | null;
  /** Result of sources.open for the current target (null while loading). */
  opened: SourceOpenView | null;
  openError: string | null;
  versions: SourceVersionView[] | undefined;
  page: number;
  scrollTop: number;
  onPosition: (patch: { page?: number; scrollTop?: number }) => void;
  onSelect: (sel: ReaderSelection | null) => void;
  /** Version dropdown: re-open the source at this immutable version. */
  onOpenVersion: (versionId: string | null) => void;
  /** Chooser actions (keyboard path) - the same save paths the inspector
   *  buttons use; both receive the frozen selection. */
  onSaveClaim: (sel: ReaderSelection) => void;
  onInsertNote: (sel: ReaderSelection) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(props.page);
  // Keyboard chooser: the selection is captured WHEN Enter/Space hits the
  // block (identity frozen right here), the buttons only pass it on.
  const [chooser, setChooser] = useState<{ sel: ReaderSelection; anchorEl: HTMLElement | null } | null>(null);
  const chooserFirst = useRef<HTMLButtonElement | null>(null);

  useEffect(() => { setPageNum(props.page); }, [props.page]);

  // Version/source switch closes the chooser with it (out of context).
  useEffect(() => { setChooser(null); }, [props.source._id, props.openVersionId]);

  // Scroll restore: reapply the remembered offset once per source, then
  // report the live offset back while scrolling (view-state mandate).
  useEffect(() => {
    const el = scrollRef.current;
    if (el && props.scrollTop > 0) el.scrollTop = props.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.source._id]);

  const reportScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) props.onPosition({ scrollTop: el.scrollTop });
  }, [props.onPosition]);

  /** Identity of the OPENED version - stamped onto every selection at
   *  capture time (never recalculated later). */
  const capture = useCallback((): Pick<ReaderSelection, "sourceId" | "versionId" | "version"> => ({
    sourceId: props.source._id,
    versionId: props.openVersionId,
    version: props.opened?.version ?? null,
  }), [props.source._id, props.openVersionId, props.opened?.version]);

  // Selection capture: pointer up or keyup (shift+arrow) inside the layer.
  useEffect(() => {
    const onMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      const layer = textRef.current;
      const node = sel?.anchorNode;
      if (sel && text && layer && node && layer.contains(node)) {
        props.onSelect({ ...capture(), page: pageNum, quote: text });
      } else if (!sel || sel.isCollapsed) {
        props.onSelect(null);
      }
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onMouseUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onMouseUp);
    };
  }, [pageNum, props.onSelect, capture]);

  // Chooser: focus the first action on open; Escape closes and returns
  // focus to the block that opened it.
  useEffect(() => {
    if (!chooser) return;
    chooserFirst.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setChooser(null);
        chooser.anchorEl?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chooser]);

  /** Keyboard path entry: freeze the full selection at Enter/Space time. */
  const openChooser = (quote: string) => {
    if (!quote.trim()) return;
    const sel: ReaderSelection = { ...capture(), page: pageNum, quote: quote.trim() };
    props.onSelect(sel);
    setChooser({ sel, anchorEl: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  };

  const runChooser = (fn: (sel: ReaderSelection) => void) => {
    if (!chooser) return;
    fn(chooser.sel);
    const back = chooser.anchorEl;
    setChooser(null);
    back?.focus();
  };

  const fileUrl = props.opened?.absolutePath ? assetUrl(props.opened.absolutePath) : null;
  const pdf = !!fileUrl && isPdf(props.source.fileName, props.opened?.absolutePath ?? "");
  const kind = mediaKind(props.source.fileName);
  const mime = props.opened?.contentType ?? props.source.fileType ?? "";
  const sheet = !!fileUrl && !pdf && !kind && (props.opened?.sidecarKind === "sheet" || /csv/i.test(mime) || /\.csv$/i.test(props.source.fileName));
  const textLike = !!fileUrl && !pdf && !kind && !sheet && /text\/(plain|markdown)/i.test(mime);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="rule-top" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-4)", flexWrap: "wrap" }}>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.source.fileName}</strong>
        <label className="mono" style={{ fontSize: "0.7rem", display: "inline-flex", gap: "var(--space-1)", alignItems: "center" }}>
          {"Version "}
          <select aria-label="Version der Quelle öffnen" value={props.openVersionId ?? ""}
            disabled={!props.versions || props.versions.length === 0}
            onChange={(e) => props.onOpenVersion(e.target.value || null)}
            style={{ fontSize: "0.75rem", textTransform: "none", letterSpacing: "normal" }}>
            {props.openVersionId == null && <option value="">aktuell</option>}
            {[...(props.versions ?? [])].reverse().map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {new Date(v.createdAt).toLocaleDateString("de-DE")}{v.pageCount != null ? ` · ${v.pageCount} S.` : ""}
              </option>
            ))}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        {pdf && numPages > 0 && (
          <span style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
            <button aria-label="Vorherige Seite" disabled={pageNum <= 1}
              onClick={() => { setPageNum(pageNum - 1); props.onPosition({ page: pageNum - 1 }); }}>←</button>
            <span className="mono" aria-live="polite" style={{ fontSize: "0.75rem" }}>{pageNum} / {numPages}</span>
            <button aria-label="Nächste Seite" disabled={numPages > 0 && pageNum >= numPages}
              onClick={() => { setPageNum(pageNum + 1); props.onPosition({ page: pageNum + 1 }); }}>→</button>
          </span>
        )}
      </div>
      <div ref={scrollRef} onScroll={reportScroll}
        style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", minHeight: 0 }}>
        {props.openError ? (
          <p style={{ color: "var(--accent)", padding: "var(--space-4)", fontSize: "0.85rem", margin: 0 }}>{props.openError}</p>
        ) : !props.opened ? (
          <p className="muted" style={{ padding: "var(--space-6)", fontSize: "0.85rem" }}>Original wird geöffnet…</p>
        ) : !fileUrl ? (
          <p className="muted" style={{ padding: "var(--space-6)", fontSize: "0.85rem" }}>
            Originaldatei nicht verfügbar - nur Zitat.
          </p>
        ) : pdf ? (
          <PdfPage key={`${props.source._id}:${props.openVersionId ?? props.opened.version}`}
            src={fileUrl} page={pageNum} onNumPages={setNumPages} textRef={textRef} onBlockSelect={openChooser} />
        ) : kind ? (
          <div style={{ padding: "var(--space-6)", width: "100%", maxWidth: 640 }}>
            <MediaView src={fileUrl} kind={kind} />
          </div>
        ) : sheet ? (
          <div style={{ padding: "var(--space-4)", width: "100%", display: "flex", justifyContent: "center" }}>
            <SheetPreview src={fileUrl} />
          </div>
        ) : textLike ? (
          <div style={{ padding: "var(--space-4)", width: "100%", display: "flex", justifyContent: "center" }}>
            <TextPreview src={fileUrl} />
          </div>
        ) : (
          <p className="muted" style={{ padding: "var(--space-6)", fontSize: "0.85rem" }}>
            Ansicht im Fenster nicht verfügbar - nur Zitat.
          </p>
        )}
      </div>
      {chooser && (
        <div role="group" aria-label="Zitat übernehmen"
          style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", padding: "var(--space-2) var(--space-4)", flexWrap: "wrap", background: "var(--surface)", borderTop: "var(--rule-structural)" }}>
          <span title={chooser.sel.quote}
            style={{ flex: 1, minWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem" }}>
            „{chooser.sel.quote}“
          </span>
          <button ref={chooserFirst} className="primary" onClick={() => runChooser(props.onSaveClaim)}>Als Beleg speichern</button>
          <button onClick={() => runChooser(props.onInsertNote)}>In Notiz einfügen</button>
          <button onClick={() => { const back = chooser.anchorEl; setChooser(null); back?.focus(); }}>
            Abbrechen (<kbd>Esc</kbd>)
          </button>
        </div>
      )}
    </div>
  );
}
