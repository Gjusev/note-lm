/**
 * SourceReader (workspace redesign D1): the center document viewer. Opens a
 * stored ORIGINAL through the only path the engine offers today -
 * evidence.open(anchorId) - and renders the page the anchor points at with
 * the existing pdf.js path (bundled worker via ?url, asset protocol src).
 *
 * On top of the canvas sits a pdf.js TextLayer: transparent glyph spans that
 * make the page text selectable. A selection inside the layer is captured
 * (page + text) and reported up as the "Als Beleg speichern" candidate.
 *
 * Gaps stated honestly in the UI:
 * - No engine op resolves a stored file by sourceId/versionId yet
 *   (sources.open), so a source without any evidence anchor cannot be opened
 *   in the viewer; version switching renders only the opened version.
 * - The anchor binds to the source's LATEST version, so a claim saved from
 *   an older version re-anchors to that latest version (banner shown).
 * - Coordinates beyond page+text are not part of the anchor contract.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { assetUrl, desktopApi, type ClaimAnchorView, type EvidenceRef, type Source } from "../lib/api";
import { isPdf, mediaKind, MediaView } from "../components/EvidencePanel";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export interface ReaderSelection {
  page: number;
  quote: string;
}

/** One rendered PDF page: canvas + selectable TextLayer. Loading/decode
 *  failures surface as German text, never a blank frame. The canvas scales
 *  to the available width; text spans are laid out in CSS px so selection
 *  rectangles match the glyphs. Only ONE page is mounted at a time (sec 9:
 *  load only nearby pages, free canvases). */
function PdfPage({ src, page, onNumPages, textRef }: {
  src: string;
  page: number;
  onNumPages: (n: number) => void;
  textRef: React.RefObject<HTMLDivElement | null>;
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
          <div ref={textRef} className="text-layer" style={{ display: state === "done" ? "block" : "none" }} />
          {state === "loading" && <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>Seite wird geladen…</p>}
        </div>
      )}
    </div>
  );
}

/** The center work surface for one source. Entry via an anchor only (gap
 *  stated in the file header and in the empty state). */
export function SourceReader(props: {
  source: Source;
  anchor: ClaimAnchorView | null;
  page: number;
  scrollTop: number;
  onPosition: (patch: { page?: number; scrollTop?: number }) => void;
  onSelect: (sel: ReaderSelection | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(props.page);
  const [ref, setRef] = useState<EvidenceRef | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => { setPageNum(props.page); }, [props.page]);

  useEffect(() => {
    let alive = true;
    setRef(null);
    setOpenError(null);
    if (!props.anchor) {
      setOpenError("no-anchor");
      return;
    }
    desktopApi.openEvidence(props.anchor.id)
      .then((r) => { if (alive) setRef(r); })
      .catch((e) => { if (alive) setOpenError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [props.anchor]);

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

  // Selection capture: pointer up or keyup (shift+arrow) inside the layer.
  useEffect(() => {
    const capture = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      const layer = textRef.current;
      const node = sel?.anchorNode;
      if (sel && text && layer && node && layer.contains(node)) {
        props.onSelect({ page: pageNum, quote: text });
      } else if (!sel || sel.isCollapsed) {
        props.onSelect(null);
      }
    };
    document.addEventListener("mouseup", capture);
    document.addEventListener("keyup", capture);
    return () => {
      document.removeEventListener("mouseup", capture);
      document.removeEventListener("keyup", capture);
    };
  }, [pageNum, props.onSelect]);

  const fileUrl = ref?.absolutePath ? assetUrl(ref.absolutePath) : null;
  const pdf = fileUrl && isPdf(props.source.fileName, ref?.absolutePath ?? "");
  const kind = mediaKind(props.source.fileName);

  const { data: versions } = useQuery({
    queryKey: ["versions", props.source._id],
    queryFn: () => desktopApi.listVersions(props.source._id),
  });
  const openedVersion = versions?.find((v) => v.version === props.anchor?.version);
  const newer = (versions ?? []).filter((v) => props.anchor != null && v.version > props.anchor.version);
  const atLatest = newer.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="rule-top" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-4)", flexWrap: "wrap" }}>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.source.fileName}</strong>
        <span className="mono" style={{ fontSize: "0.7rem" }}>
          {props.anchor ? `v${props.anchor.version}` : "v?"}
          {openedVersion?.pageCount != null ? ` · ${openedVersion.pageCount} S.` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {pdf && numPages > 0 && (
          <span style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
            <button aria-label="Vorherige Seite" disabled={pageNum <= 1}
              onClick={() => { props.onSelect(null); setPageNum(pageNum - 1); props.onPosition({ page: pageNum - 1 }); }}>←</button>
            <span className="mono" aria-live="polite" style={{ fontSize: "0.75rem" }}>{pageNum} / {numPages}</span>
            <button aria-label="Nächste Seite" disabled={numPages > 0 && pageNum >= numPages}
              onClick={() => { props.onSelect(null); setPageNum(pageNum + 1); props.onPosition({ page: pageNum + 1 }); }}>→</button>
          </span>
        )}
      </div>
      {props.anchor && !atLatest && (
        <p style={{ margin: 0, padding: "var(--space-1) var(--space-4)", fontSize: "0.8rem", background: "var(--accent-soft)" }}>
          Neuere Version verfügbar (v{newer[0].version}). Dein Blick bleibt auf v{props.anchor.version} - Wechseln ist noch nicht möglich
          (fehlender Engine-Op sources.open); ein neuer Beleg bindet an die neueste Version.
        </p>
      )}
      <div ref={scrollRef} onScroll={reportScroll}
        style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", minHeight: 0 }}>
        {!props.anchor ? (
          <p className="muted" style={{ padding: "var(--space-6)", fontSize: "0.9rem", maxWidth: 480 }}>
            Diese Quelle ist ohne gespeicherten Beleg noch nicht öffnbar: Der Viewer lädt das
            Original über einen Beleg-Anker (evidence.open). Ein Op sources.open (Original per
            Quellen-ID öffnen) fehlt noch - siehe Lückenliste. Speichere erst einen Beleg.
          </p>
        ) : openError ? (
          <p style={{ color: "var(--accent)", padding: "var(--space-4)", fontSize: "0.85rem", margin: 0 }}>{openError}</p>
        ) : !fileUrl ? (
          <p className="muted" style={{ padding: "var(--space-6)", fontSize: "0.85rem" }}>
            Originaldatei nicht verfügbar - nur Zitat.
          </p>
        ) : pdf ? (
          <PdfPage key={props.anchor.id} src={fileUrl} page={pageNum} onNumPages={setNumPages} textRef={textRef} />
        ) : kind && ref?.locator ? (
          <div style={{ padding: "var(--space-6)", width: "100%", maxWidth: 640 }}>
            <MediaView src={fileUrl} kind={kind} locator={ref.locator} />
          </div>
        ) : (
          <div style={{ padding: "var(--space-6)", maxWidth: 560 }}>
            <blockquote style={{ margin: 0, padding: "0 0 0 var(--space-3)", borderLeft: "3px solid var(--accent-soft)", fontFamily: "Georgia, 'Times New Roman', serif", fontSize: "1.05rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {ref?.quote ?? props.anchor.quote}
            </blockquote>
            <p className="muted" style={{ fontSize: "0.8rem" }}>
              Ansicht im Fenster nicht verfügbar - nur Zitat.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
