/**
 * Center panels (moved from the old NotebookWorkspace tabs): calculations
 * and materials keep their engine wiring; they are center work surfaces
 * now, opened from the left navigator collections.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, type Source } from "../lib/api";
import { fmtDate, t } from "../i18n";

/** Deterministic op label (translation key by engine op id; unknown ops
 *  surface the raw engine id — t() would return the key itself). */
export function opLabel(op: string): string {
  const key = `calc.op.${op}`;
  const raw = t(key);
  return raw === key ? op : raw;
}

/** German->any labels for the engine's material types (materials.request
 *  VALID_TYPES); order = the select's order. */
export const MATERIAL_TYPES: ReadonlyArray<{ id: string; labelKey: string }> = [
  { id: "summary", labelKey: "materials.type.summary" },
  { id: "flashcards", labelKey: "materials.type.flashcards" },
  { id: "quiz", labelKey: "materials.type.quiz" },
  { id: "studyGuide", labelKey: "materials.type.studyGuide" },
  { id: "keyInsights", labelKey: "materials.type.keyInsights" },
  { id: "podcastSummary", labelKey: "materials.type.podcastSummary" },
  { id: "slides", labelKey: "materials.type.slides" },
];

export function materialTypeLabel(id: string): string {
  const entry = MATERIAL_TYPES.find((m) => m.id === id);
  return entry ? t(entry.labelKey) : id;
}

/** Calculations: deterministic sheet ops over an immutable source version.
 *  The big result plus the exact inputs (version, op, column, filter) is the
 *  reproducibility record; a blocked op shows the engine's typed German
 *  error verbatim and records nothing. */
export function CalcPanel(props: { notebookId: string; sources: Source[] }) {
  const queryClient = useQueryClient();
  const ordered = [...props.sources].sort((a, b) =>
    a.fileType.includes("csv") === b.fileType.includes("csv") ? 0 : a.fileType.includes("csv") ? -1 : 1
  );
  const [sourceId, setSourceId] = useState<string | null>(null);
  const activeSourceId = sourceId ?? ordered[0]?._id ?? "";
  const [versionId, setVersionId] = useState<string | null>(null);
  const [op, setOp] = useState<"sum" | "avg" | "min" | "max" | "count">("sum");
  const [col, setCol] = useState("");
  const [fCol, setFCol] = useState("");
  const [fVal, setFVal] = useState("");
  const activeSource = ordered.find((s) => s._id === activeSourceId);
  const isCsv = activeSource?.fileType.includes("csv") ?? false;

  const { data: versions } = useQuery({
    queryKey: ["versions", activeSourceId],
    queryFn: () => desktopApi.listVersions(activeSourceId),
    enabled: activeSourceId !== "",
  });
  const activeVersionId = versionId ?? versions?.[versions.length - 1]?.id ?? "";
  const activeVersion = versions?.find((v) => v.id === activeVersionId);

  const run = useMutation({
    mutationFn: () => {
      const parseCol = (raw: string): string | number =>
        /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw.trim();
      return desktopApi.runCalculation({
        notebookId: props.notebookId,
        sourceId: activeSourceId,
        sourceVersionId: activeVersionId || undefined,
        op,
        column: parseCol(col),
        filter: fCol.trim() && fVal.trim() ? { column: parseCol(fCol), equals: fVal.trim() } : undefined,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calculations", props.notebookId] }),
  });
  const { data: history } = useQuery({
    queryKey: ["calculations", props.notebookId],
    queryFn: () => desktopApi.listCalculations(props.notebookId),
  });
  const versionLabels = useQuery({
    queryKey: ["calc-version-labels", props.notebookId],
    queryFn: async () => {
      const lists = await Promise.all(props.sources.map((s) => desktopApi.listVersions(s._id)));
      return new Map(lists.flat().map((v) => [v.id, v.version]));
    },
    enabled: props.sources.length > 0,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", overflowY: "auto", minHeight: 0, flex: 1, padding: "var(--space-4)" }}>
      {ordered.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {t("calc.needSource")}
        </p>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); if (!run.isPending) run.mutate(); }}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 420 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              {t("nav.sources")}
              <select value={activeSourceId} aria-label={t("calc.sourceAria")}
                onChange={(e) => { setSourceId(e.target.value); setVersionId(null); }}>
                {ordered.map((s) => <option key={s._id} value={s._id}>{s.fileName}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              {t("reader.version")}
              <select value={activeVersionId} aria-label={t("calc.versionAria")}
                disabled={(versions ?? []).length === 0} onChange={(e) => setVersionId(e.target.value)}>
                {(versions ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.pageCount != null
                      ? t("calc.versionOptionPages", { v: v.version, n: v.pageCount, date: fmtDate(v.createdAt) })
                      : t("calc.versionOptionCsv", { v: v.version, date: fmtDate(v.createdAt) })}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              {t("calc.operation")}
              <select value={op} aria-label={t("calc.operationAria")} onChange={(e) => setOp(e.target.value as typeof op)}>
                {(["sum", "avg", "min", "max", "count"] as const).map((o) => (
                  <option key={o} value={o}>{t(`calc.op.${o}`)}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              {t("calc.column")}
              <input value={col} onChange={(e) => setCol(e.target.value)} placeholder={t("calc.columnPlaceholder")} aria-label={t("calc.columnAria")} />
            </label>
            <details>
              <summary style={{ fontSize: "0.8rem", cursor: "pointer" }}>{t("calc.filter")}</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", marginTop: "var(--space-1)" }}>
                <input value={fCol} onChange={(e) => setFCol(e.target.value)} placeholder={t("calc.columnAria")} aria-label={t("calc.filterColumnAria")} />
                <input value={fVal} onChange={(e) => setFVal(e.target.value)} placeholder={t("calc.filterValuePh")} aria-label={t("calc.filterValueAria")} />
              </div>
            </details>
            <button className="primary" type="submit" disabled={!col.trim() || run.isPending}>
              {run.isPending ? t("calc.running") : t("calc.run")}
            </button>
          </form>

          {run.data && (
            <div className="rule-top" style={{ paddingTop: "var(--space-2)" }}>
              <div style={{ fontSize: "1.6rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{run.data.result}</div>
              <p className="muted" style={{ margin: "var(--space-1) 0 0", fontSize: "0.75rem" }}>
                {t("calc.resultMeta", {
                  version: activeVersion ? `v${activeVersion.version}` : activeVersionId || t("calc.latestVersion"),
                  op: opLabel(run.data.operation),
                  column: String(JSON.parse(run.data.argsJson).column),
                })}
                {(() => {
                  const f = JSON.parse(run.data.argsJson).filter;
                  if (!f) return null;
                  return t("calc.resultFilter", { column: String(f.column), value: f.equals });
                })()}
              </p>
              {isCsv ? null : <p className="muted" style={{ margin: "var(--space-1) 0 0", fontSize: "0.75rem" }}>{t("calc.notCsv")}</p>}
            </div>
          )}
          {run.isError && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{run.error.message}</p>}
        </>
      )}
      {(history ?? []).length > 0 && (
        <div className="rule-top" style={{ paddingTop: "var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <span className="mono">{t("calc.history")}</span>
          {(history ?? []).slice().reverse().map((c) => {
            let args: { op: string; column: string | number; filter: { column: string | number; equals: string } | null } | null = null;
            try {
              args = JSON.parse(c.argsJson);
            } catch {
              args = null;
            }
            return (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", fontSize: "0.8rem", alignItems: "baseline" }}>
                <span>
                  {t("calc.historyRow", { op: opLabel(c.operation), column: args ? String(args.column) : "?" })}
                  {args?.filter ? t("calc.resultFilter", { column: String(args.filter.column), value: args.filter.equals }) : ""}
                  {versionLabels.data?.get(c.sourceVersionId) != null ? t("calc.versionSuffix", { v: versionLabels.data.get(c.sourceVersionId)! }) : ""}
                </span>
                <strong>{c.result ?? c.error}</strong>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Materials: pick a type, request generation (typed busy error verbatim),
 *  list every material with polling while any row is non-terminal. */
export function MaterialsPanel(props: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState("summary");
  const { data: materials } = useQuery({
    queryKey: ["materials", props.notebookId],
    queryFn: () => desktopApi.listMaterials(props.notebookId),
    refetchInterval: (q) => q.state.data?.some((m) => m.status === "pending" || m.status === "generating") ? 3000 : false,
  });
  const request = useMutation({
    mutationFn: () => desktopApi.requestMaterial(props.notebookId, type),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["materials", props.notebookId] }),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", overflowY: "auto", minHeight: 0, flex: 1, padding: "var(--space-4)" }}>
      <form onSubmit={(e) => { e.preventDefault(); if (!request.isPending) request.mutate(); }}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 420 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
          {t("materials.type")}
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t("materials.type")}>
            {MATERIAL_TYPES.map((m) => <option key={m.id} value={m.id}>{t(m.labelKey)}</option>)}
          </select>
        </label>
        <button className="primary" type="submit" disabled={request.isPending}>
          {request.isPending ? t("materials.creating") : t("library.create")}
        </button>
        {request.isError && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{request.error.message}</p>}
      </form>
      {(materials ?? []).length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          {t("materials.none")}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {(materials ?? []).map((m) => (
            <div key={m._id} style={{ padding: "var(--space-2)", border: "1px solid var(--rule)", fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>{materialTypeLabel(m.type)}</strong>
                {m.status === "completed" ? (
                  <span className="meta" style={{ fontSize: "0.7rem" }}>{fmtDate(m.updatedAt)}</span>
                ) : m.status === "error" ? (
                  <span className="chip" style={{ background: "var(--status-error)", color: "var(--status-error-fg)" }}>{t("common.error")}</span>
                ) : (
                  <span className="chip" style={{ background: "var(--status-info)", color: "var(--status-info-fg)" }}>{t("materials.creatingChip")}</span>
                )}
                {m.needsReview === 1 && (
                  <span className="chip" style={{ background: "var(--status-warning)", color: "var(--status-warning-fg)" }} title={t("materials.needsReviewTitle")}>
                    {t("materials.needsReview")}
                  </span>
                )}
              </div>
              {m.status === "error" && m.errorMessage && <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{m.errorMessage}</p>}
              {m.status === "completed" && m.content && <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{m.content}</p>}
              {(m.status === "pending" || m.status === "generating") && (
                <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                  {m.status === "pending" ? t("materials.queued") : t("materials.generating")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
