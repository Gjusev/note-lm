/**
 * MatrixView (evidence matrix, docs/proposals/evidence-matrix.md + the four
 * contract corrections): the differential center view. Rows are the
 * notebook's claims, columns the SELECTED sources - an explicitly selected
 * source always renders, with honest "Nicht geprüft" cells at zero
 * relations (correction 1). A cell never asserts truth; it shows what is
 * RECORDED: evidence anchors at their own immutable versions, pending
 * review proposals, and the collapsed decision history (resolved proposals
 * keep their history but never an alert - correction 2). One cell can hold
 * evidence AND a pending review; the status says "Prüfung offen" while the
 * evidence chips stay visible (correction 3). Opens are version-pinned:
 * an evidence chip opens ITS anchored version, a pending proposal opens the
 * origin (from) version and offers the destination as an explicit
 * "Zielversion öffnen" button - v1 is never silently swapped for v2
 * (correction 4). Deciding happens in the inspector (existing
 * review.resolve seam); the matrix only reads.
 *
 * "In Auswahl suchen" (search.run): runs the hybrid search scoped to the
 * selected columns and records the run - a source the search did NOT
 * surface then shows not_found_in_search naming that exact run (query +
 * time), never a claim about the source itself.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleDashed,
  Link2,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { desktopApi, matrixCellKey, type MatrixCellView, type Source } from "../lib/api";
import { ErrorLine } from "../lib/errors";
import { formatTimeRange } from "../components/EvidencePanel";
import { fmtDate, fmtDateTime, t } from "../i18n";

/** Status text + icon (never color alone); the renderer covers all four
 *  contract statuses. not_found_in_search names its covering run via
 *  cell.searchProvenance (migration 0014). Labels are translation keys. */
const STATUS: Record<MatrixCellView["status"], { icon: LucideIcon; labelKey: string }> = {
  evidence: { icon: Link2, labelKey: "matrix.statusEvidence" },
  pending_review: { icon: TriangleAlert, labelKey: "matrix.statusPending" },
  not_reviewed: { icon: CircleDashed, labelKey: "matrix.statusNotReviewed" },
  not_found_in_search: { icon: SearchX, labelKey: "matrix.statusNotFound" },
};

const RELATION_LABEL: Record<string, string> = { supports: "matrix.relationSupports", questions: "matrix.relationQuestions" };
const DECISION_LABEL: Record<string, string> = { accepted: "matrix.decisionAccepted", rejected: "matrix.decisionRejected" };

function snippet(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function MatrixView(props: {
  notebookId: string;
  sources: Source[];
  /** Open a source at one immutable version number (the composition root
   *  resolves the row id and routes through the shared reader path). */
  openAtVersion: (sourceId: string, version: number, page?: number | null) => void;
  /** Select a claim into the inspector (fragments, decisions, resolve UI). */
  onSelectClaim: (claimId: string) => void;
}) {
  const queryClient = useQueryClient();
  // null = the engine default (sources with recorded relations); once the
  // user toggles a chip the selection is explicit and survives refetches.
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hScrollable, setHScrollable] = useState(false);
  const [query, setQuery] = useState("");

  const { data } = useQuery({
    queryKey: ["matrix", props.notebookId, selectedIds],
    queryFn: () => desktopApi.getMatrix(props.notebookId, undefined, selectedIds ?? undefined),
  });

  /** Performed search over the CURRENT column selection (search.run): the
   *  recorded run is what a later not_found_in_search cell names, so the
   *  matrix must refetch after every run. */
  const search = useMutation({
    mutationFn: (q: string) =>
      desktopApi.runSearch(props.notebookId, q, (selectedIds ?? columns.map((c) => c.id))),
    onSuccess: () => {
      // the miss/provenance derivation reads the recorded runs: refresh
      // every matrix query of this notebook (any column selection)
      void queryClient.invalidateQueries({ queryKey: ["matrix", props.notebookId] });
    },
  });

  const claims = data?.claims ?? [];
  const columns = data?.sources ?? [];
  const cells = useMemo(() => {
    const map = new Map<string, MatrixCellView>();
    for (const cell of data?.cells ?? []) map.set(matrixCellKey(cell.claimId, cell.sourceId), cell);
    return map;
  }, [data]);

  // Narrow-window hint (contract §5): the grid scrolls horizontally instead
  // of crushing - measured, so the hint only shows when it is true.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setHScrollable(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const isPressed = (id: string) =>
    selectedIds ? selectedIds.includes(id) : columns.some((c) => c.id === id);

  const toggleSource = (id: string) => {
    const base = selectedIds ?? columns.map((c) => c.id);
    setSelectedIds(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  };

  /** Roving tabindex move (APG grid pattern, reduced to a plain table): the
   *  focused td is the only tab stop; arrows/Home/End move, Enter/Space
   *  activate the focused cell's primary action. */
  const move = (r: number, c: number) => {
    const next = {
      r: Math.min(claims.length - 1, Math.max(0, r)),
      c: Math.min(columns.length - 1, Math.max(0, c)),
    };
    setFocus(next);
    cellRefs.current.get(`${next.r}:${next.c}`)?.focus();
  };

  /** Primary action of one cell (click and Enter/Space): a pending proposal
   *  opens its ORIGIN (from) version and selects the claim for the decision
   *  in the inspector; an evidence cell opens its first anchor at ITS
   *  version; a not_reviewed cell has nothing recorded to open. */
  const activate = (cell: MatrixCellView | undefined, sourceId: string) => {
    if (!cell) return;
    if (cell.pendingProposals.length > 0) {
      props.onSelectClaim(cell.claimId);
      props.openAtVersion(sourceId, cell.pendingProposals[0].fromVersion);
      return;
    }
    if (cell.evidence.length > 0) {
      const anchor = cell.evidence[0];
      props.openAtVersion(sourceId, anchor.version, anchor.page);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, minWidth: 0 }}>
      {/* Toolbar: the source multi-select - every notebook source is
          selectable, so a zero-relation source can be confronted (its
          column then renders "Nicht geprüft", correction 1). The printed
          table's structural rule opens the block above the search row. */}
      <div style={{ borderTop: "var(--rule-structural)", padding: "var(--space-2) var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap", alignItems: "center" }}>
          <span className="mono" style={{ fontSize: "0.7rem" }}>{t("matrix.columns")}</span>
          {props.sources.map((s) => (
            <button key={s._id} aria-pressed={isPressed(s._id)} onClick={() => toggleSource(s._id)}
              title={s.fileName}
              style={{
                fontSize: "0.75rem", padding: "0 var(--space-2)",
                background: isPressed(s._id) ? "var(--ink)" : "transparent",
                color: isPressed(s._id) ? "var(--paper)" : "var(--ink)",
                border: `1px solid ${isPressed(s._id) ? "var(--ink)" : "var(--rule)"}`,
                fontWeight: isPressed(s._id) ? 600 : 400,
                maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
              {s.fileName}
            </button>
          ))}
          {props.sources.length === 0 && (
            <span className="muted" style={{ fontSize: "0.8rem" }}>{t("nav.noSources")}</span>
          )}
        </div>
        {/* Scoped search (search.run): records the performed search whose
            misses the cells then name. Scope = the column selection above. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim() && !search.isPending && columns.length > 0) search.mutate(query.trim());
          }}
          style={{ display: "flex", gap: "var(--space-1)", alignItems: "center", flexWrap: "wrap" }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("matrix.searchPlaceholder")}
            aria-label={t("matrix.searchAria")}
            disabled={search.isPending || columns.length === 0}
            style={{ maxWidth: 260, fontSize: "0.8rem", padding: "0 var(--space-2)" }}
          />
          <button type="submit" style={{ fontSize: "0.75rem", padding: "0 var(--space-2)" }}
            disabled={!query.trim() || search.isPending || columns.length === 0}>
            {search.isPending ? t("matrix.searching") : t("matrix.search")}
          </button>
          {search.data && (
            <span className="meta" style={{ fontSize: "0.65rem" }} role="status">
              {t("matrix.searchStats", { hits: search.data.hits.length, n: search.data.sourceIds.length })}
            </span>
          )}
          {search.isError && (
            <ErrorLine e={search.error} style={{ color: "var(--status-error)", fontSize: "0.75rem" }} />
          )}
        </form>
        {/* Legend line is part of the contract, not a tooltip (§5): the
            empty-sounding statuses are worded distinctly and honestly. */}
        <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
          {t("matrix.legend")}
          {hScrollable ? ` ${t("matrix.legendScroll")}` : ""}
        </p>
      </div>

      {claims.length === 0 ? (
        <p className="meta" style={{ padding: "var(--space-6)", fontSize: "0.68rem", lineHeight: 1.6, margin: 0 }}>
          {t("matrix.noClaims")}
        </p>
      ) : (
        <div ref={scrollRef} style={{ overflow: "auto", minHeight: 0, flex: 1 }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: "0.8rem", minWidth: Math.max(560, 200 + columns.length * 200) }}>
            <thead>
              <tr>
                <th scope="col" style={{ position: "sticky", top: 0, left: 0, zIndex: 3, background: "var(--surface)", textAlign: "left", padding: "var(--space-2)", borderTop: "var(--rule-structural)", borderBottom: "var(--rule-structural)", borderRight: "1px solid var(--rule)", minWidth: 200, fontFamily: "var(--font-meta)", fontSize: "0.68rem", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 650 }}>
                  {t("matrix.claimColumn")}
                </th>
                {columns.map((col) => (
                  <th key={col.id} scope="col" style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--surface)", textAlign: "left", padding: "var(--space-2)", borderTop: "var(--rule-structural)", borderBottom: "var(--rule-structural)", borderRight: "1px solid var(--rule)", minWidth: 200, fontFamily: "var(--font-meta)", fontSize: "0.68rem", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 650 }}>
                    {col.fileName}
                    {col.latestVersion != null && (
                      <span className="mono" style={{ fontSize: "0.65rem", display: "block" }}>{t("matrix.latest", { v: col.latestVersion })}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {claims.map((claim, r) => (
                <tr key={claim.id}>
                  <th scope="row" style={{ position: "sticky", left: 0, zIndex: 1, background: "var(--surface)", textAlign: "left", padding: "var(--space-2)", borderRight: "1px solid var(--rule)", maxWidth: 320, fontWeight: 400 }}>
                    <span title={claim.text} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{claim.text}</span>
                  </th>
                  {columns.map((col, c) => {
                    const cell = cells.get(matrixCellKey(claim.id, col.id));
                    return (
                      <td
                        key={col.id}
                        ref={(el) => {
                          if (el) cellRefs.current.set(`${r}:${c}`, el);
                          else cellRefs.current.delete(`${r}:${c}`);
                        }}
                        tabIndex={focus.r === r && focus.c === c ? 0 : -1}
                        aria-label={`${claim.text} — ${col.fileName}: ${t(cell ? STATUS[cell.status].labelKey : STATUS.not_reviewed.labelKey)}`}
                        onFocus={() => setFocus({ r, c })}
                        onClick={() => activate(cell, col.id)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowRight") { e.preventDefault(); move(r, c + 1); }
                          if (e.key === "ArrowLeft") { e.preventDefault(); move(r, c - 1); }
                          if (e.key === "ArrowDown") { e.preventDefault(); move(r + 1, c); }
                          if (e.key === "ArrowUp") { e.preventDefault(); move(r - 1, c); }
                          if (e.key === "Home") { e.preventDefault(); move(r, 0); }
                          if (e.key === "End") { e.preventDefault(); move(r, columns.length - 1); }
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(cell, col.id); }
                        }}
                        style={{ padding: "var(--space-2)", borderRight: "1px solid var(--rule)", verticalAlign: "top", minWidth: 200, cursor: "default",
                          outline: focus.r === r && focus.c === c ? "2px solid var(--accent)" : undefined, outlineOffset: -2 }}
                      >
                        <CellBody
                          cell={cell}
                          sourceId={col.id}
                          openAtVersion={props.openAtVersion}
                          onSelectClaim={props.onSelectClaim}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {columns.length === 0 && (
            <p className="meta" style={{ padding: "var(--space-4)", fontSize: "0.68rem", lineHeight: 1.6, margin: 0 }}>
              {t("matrix.noRelations")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Everything inside one cell: status line, evidence chips (each opens ITS
 *  anchored version), pending proposal lines (origin version + explicit
 *  destination button), collapsed decision history. A not_found_in_search
 *  cell names its covering run (query + time) - the provenance store makes
 *  the miss verifiable, not a vague "not found". */
function CellBody(props: {
  cell: MatrixCellView | undefined;
  sourceId: string;
  openAtVersion: (sourceId: string, version: number, page?: number | null) => void;
  onSelectClaim: (claimId: string) => void;
}) {
  const cell = props.cell;
  if (!cell) return <span className="muted">–</span>;
  const status = STATUS[cell.status];
  const StatusIcon = status.icon;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <span style={{ display: "inline-flex", gap: "var(--space-1)", alignItems: "center", fontSize: "0.75rem" }}>
        <StatusIcon size={14} aria-hidden />
        {t(status.labelKey)}
        {cell.evidence.length > 0 && cell.pendingProposals.length > 0 && (
          <span className="mono" style={{ fontSize: "0.65rem" }}>{t("matrix.moreEvidence", { n: cell.evidence.length })}</span>
        )}
      </span>

      {cell.status === "not_found_in_search" && cell.searchProvenance && (
        <span className="meta" style={{ fontSize: "0.65rem", textTransform: "none", letterSpacing: "0.04em" }}>
          {t("matrix.searchProvenance", { query: cell.searchProvenance.query, date: fmtDateTime(cell.searchProvenance.searchedAt) })}
        </span>
      )}

      {cell.evidence.map((a) => (
        <button key={a.anchorId}
          title={a.quote}
          onClick={(e) => { e.stopPropagation(); props.openAtVersion(props.sourceId, a.version, a.page); }}
          style={{ fontSize: "0.75rem", padding: 0, textAlign: "left", alignSelf: "flex-start", maxWidth: "100%",
            background: "transparent", color: "inherit", border: "none", textDecoration: "underline" }}
        >
          <span style={{ display: "inline-block", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
            {RELATION_LABEL[a.relation] ? t(RELATION_LABEL[a.relation]) : a.relation} · v{a.version} ·{" "}
            {a.locator ? formatTimeRange(a.locator) : a.page != null ? t("common.pageShort", { n: a.page }) : t("matrix.noLoc")} — {snippet(a.quote)}
          </span>
        </button>
      ))}

      {cell.pendingProposals.map((p) => (
        <div key={p.proposalId} style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", borderLeft: "2px solid var(--warn)", paddingLeft: "var(--space-2)" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              // correction 4: the ORIGIN version opens; the destination is a
              // separate explicit button - never a silent swap
              props.onSelectClaim(cell.claimId);
              props.openAtVersion(props.sourceId, p.fromVersion);
            }}
            title={p.detail ?? p.reason}
            style={{ fontSize: "0.75rem", padding: 0, textAlign: "left", textDecoration: "underline",
              background: "transparent", color: "inherit", border: "none" }}
          >
            {t("matrix.proposalOpen", {
              from: p.fromVersion,
              to: p.toVersion,
              reason: p.reason === "quote_moved" ? t("matrix.reasonQuoteMoved") : t("matrix.reasonQuoteMissing"),
            })}
          </button>
          <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
            <button style={{ fontSize: "0.7rem", padding: "0 var(--space-1)" }}
              onClick={(e) => { e.stopPropagation(); props.openAtVersion(props.sourceId, p.toVersion); }}>
              {t("matrix.openTarget", { v: p.toVersion })}
            </button>
            <button style={{ fontSize: "0.7rem", padding: "0 var(--space-1)" }}
              onClick={(e) => { e.stopPropagation(); props.onSelectClaim(cell.claimId); }}>
              {t("matrix.decide")}
            </button>
          </div>
        </div>
      ))}

      {cell.resolvedProposals.length > 0 && (
        <details onClick={(e) => e.stopPropagation()}>
          <summary style={{ fontSize: "0.7rem", cursor: "pointer" }}>{t("matrix.history", { n: cell.resolvedProposals.length })}</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", paddingTop: "var(--space-1)" }}>
            {cell.resolvedProposals.map((p) => (
              <span key={p.proposalId} className="muted" style={{ fontSize: "0.7rem" }}>
                {t("matrix.resolvedRow", {
                  decision: DECISION_LABEL[p.status] ? t(DECISION_LABEL[p.status]) : p.status,
                  from: p.fromVersion,
                  to: p.toVersion,
                })}
                {p.resolvedAt != null ? t("matrix.resolvedDate", { date: fmtDate(p.resolvedAt) }) : ""}
                {p.note ? t("matrix.resolvedNote", { note: p.note }) : ""}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
