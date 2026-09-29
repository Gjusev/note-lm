/**
 * Center panels (moved from the old NotebookWorkspace tabs): calculations
 * and materials keep their engine wiring; they are center work surfaces
 * now, opened from the left navigator collections.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, type Source } from "../lib/api";

export const OP_LABELS: Record<string, string> = {
  sum: "Summe", avg: "Durchschnitt", min: "Minimum", max: "Maximum", count: "Anzahl",
};

/** German labels for the engine's material types (materials.request
 *  VALID_TYPES); order = the select's order. */
export const MATERIAL_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "summary", label: "Zusammenfassung" },
  { id: "flashcards", label: "Lernkarten" },
  { id: "quiz", label: "Quiz" },
  { id: "studyGuide", label: "Lernleitfaden" },
  { id: "keyInsights", label: "Kernpunkte" },
  { id: "podcastSummary", label: "Podcast-Zusammenfassung" },
  { id: "slides", label: "Folien" },
];

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
          Berechnungen brauchen eine Quelle. Importiere zuerst eine CSV-Datei.
        </p>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); if (!run.isPending) run.mutate(); }}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", maxWidth: 420 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              Quelle
              <select value={activeSourceId} aria-label="Quelle für die Berechnung"
                onChange={(e) => { setSourceId(e.target.value); setVersionId(null); }}>
                {ordered.map((s) => <option key={s._id} value={s._id}>{s.fileName}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              Version
              <select value={activeVersionId} aria-label="Version für die Berechnung"
                disabled={(versions ?? []).length === 0} onChange={(e) => setVersionId(e.target.value)}>
                {(versions ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version} · {v.pageCount != null ? `${v.pageCount} S.` : "CSV"} · {new Date(v.createdAt).toLocaleDateString("de-DE")}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              Operation
              <select value={op} aria-label="Berechnungsoperation" onChange={(e) => setOp(e.target.value as typeof op)}>
                <option value="sum">Summe</option>
                <option value="avg">Durchschnitt</option>
                <option value="min">Minimum</option>
                <option value="max">Maximum</option>
                <option value="count">Anzahl</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              Spalte (Name oder Nummer)
              <input value={col} onChange={(e) => setCol(e.target.value)} placeholder="z. B. Menge oder 2" aria-label="Spalte" />
            </label>
            <details>
              <summary style={{ fontSize: "0.8rem", cursor: "pointer" }}>Filter (optional)</summary>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", marginTop: "var(--space-1)" }}>
                <input value={fCol} onChange={(e) => setFCol(e.target.value)} placeholder="Spalte" aria-label="Filterspalte" />
                <input value={fVal} onChange={(e) => setFVal(e.target.value)} placeholder="ist gleich" aria-label="Filterwert" />
              </div>
            </details>
            <button className="primary" type="submit" disabled={!col.trim() || run.isPending}>
              {run.isPending ? "Berechne…" : "Berechnen"}
            </button>
          </form>

          {run.data && (
            <div className="rule-top" style={{ paddingTop: "var(--space-2)" }}>
              <div style={{ fontSize: "1.6rem", fontWeight: 700, fontFamily: "var(--font-mono)" }}>{run.data.result}</div>
              <p className="muted" style={{ margin: "var(--space-1) 0 0", fontSize: "0.75rem" }}>
                {activeVersion ? `v${activeVersion.version}` : activeVersionId || "neueste Version"} · {OP_LABELS[run.data.operation] ?? run.data.operation} · Spalte {String(JSON.parse(run.data.argsJson).column)}
                {(() => {
                  const f = JSON.parse(run.data.argsJson).filter;
                  if (!f) return null;
                  return <> · Filter {String(f.column)} = "{f.equals}"</>;
                })()}
              </p>
              {isCsv ? null : <p className="muted" style={{ margin: "var(--space-1) 0 0", fontSize: "0.75rem" }}>Hinweis: Quelle ist keine CSV - die Engine blockiert solche Ops mit einem klaren Fehler.</p>}
            </div>
          )}
          {run.isError && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{run.error.message}</p>}
        </>
      )}
      {(history ?? []).length > 0 && (
        <div className="rule-top" style={{ paddingTop: "var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <span className="mono">Frühere Berechnungen</span>
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
                  {OP_LABELS[c.operation] ?? c.operation} · Spalte {args ? String(args.column) : "?"}
                  {args?.filter ? ` · Filter ${String(args.filter.column)} = "${args.filter.equals}"` : ""}
                  {versionLabels.data?.get(c.sourceVersionId) != null ? ` · v${versionLabels.data.get(c.sourceVersionId)}` : ""}
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
          Materialtyp
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Materialtyp">
            {MATERIAL_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <button className="primary" type="submit" disabled={request.isPending}>
          {request.isPending ? "Wird erstellt…" : "Erstellen"}
        </button>
        {request.isError && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{request.error.message}</p>}
      </form>
      {(materials ?? []).length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Noch keine Materialien. Typ wählen und „Erstellen“ drücken.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {(materials ?? []).map((m) => (
            <div key={m._id} style={{ padding: "var(--space-2)", border: "1px solid var(--rule)", fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>{MATERIAL_TYPES.find((t) => t.id === m.type)?.label ?? m.type}</strong>
                {m.status === "completed" ? (
                  <span className="meta" style={{ fontSize: "0.7rem" }}>{new Date(m.updatedAt).toLocaleDateString("de-DE")}</span>
                ) : m.status === "error" ? (
                  <span className="chip" style={{ background: "var(--status-error)", color: "var(--status-error-fg)" }}>Fehler</span>
                ) : (
                  <span className="chip" style={{ background: "var(--status-info)", color: "var(--status-info-fg)" }}>wird erstellt…</span>
                )}
                {m.needsReview === 1 && (
                  <span className="chip" style={{ background: "var(--status-warning)", color: "var(--status-warning-fg)" }} title="Eine versionierte Quelle, aus der dieses Material erstellt wurde, wurde geändert.">
                    Quelle geändert - Inhalt prüfen
                  </span>
                )}
              </div>
              {m.status === "error" && m.errorMessage && <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{m.errorMessage}</p>}
              {m.status === "completed" && m.content && <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{m.content}</p>}
              {(m.status === "pending" || m.status === "generating") && (
                <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                  {m.status === "pending" ? "In der Warteschlange…" : "Wird generiert…"}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
