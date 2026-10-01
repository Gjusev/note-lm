/**
 * SourceNavigator (workspace redesign para 5): the left column. The five old
 * 300px tabs become object collections in one vertical navigation -
 * Quellen, Notizen, Aussagen, Berechnungen, Materialien - as collapsible
 * sections. Old tab labels stay (mandate 1). Sources open in the center
 * reader, notes in the center editor; claims select into the inspector;
 * calculations/materials open their center views.
 *
 * Neo-Swiss depth: every section header is a numbered index row (mono
 * "01 QUELLEN" + count) under a 2px structural rule; source rows read as
 * archive-index entries (two-digit index, name, status chip right, hairline
 * separators only - no card boxes); claims are filed index cards.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, pickFile, type ClaimView, type Source } from "../lib/api";
import { fmtDate, t } from "../i18n";
import type { NotebookUiState } from "../lib/uiState";
import { GeometricMark } from "./GeometricMark";

const twoDigits = (n: number): string => String(n + 1).padStart(2, "0");

/** One collapsible collection: numbered index header (mono caps + count)
 *  under a 2px structural rule. aria-label stays the plain title. */
function Section(props: {
  id: string;
  index: string;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="navigator-section" aria-label={props.title} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="navigator-section-header" style={{ borderBottom: "2px solid var(--ink)", paddingBottom: "var(--space-1)" }}>
        <button
          aria-expanded={props.open}
          aria-controls={"nav-section-" + props.id}
          onClick={props.onToggle}
          style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)", width: "100%", padding: "var(--space-1) 0", textAlign: "left", background: "transparent", color: "inherit", border: "none" }}
        >
          <span className="mono" style={{ fontSize: "0.68rem" }}>{props.index}</span>
          <span className="mono" style={{ fontSize: "0.72rem", fontWeight: 650, color: "var(--ink)", flex: 1 }}>{props.title}</span>
          <span className="mono" style={{ fontSize: "0.68rem" }}>{props.count}</span>
          <span aria-hidden style={{ fontSize: "0.65rem", color: "var(--ink-60)" }}>{props.open ? "▾" : "▸"}</span>
        </button>
      </div>
      {props.open && (
        <div id={"nav-section-" + props.id} style={{ display: "flex", flexDirection: "column", paddingTop: "var(--space-2)", gap: "var(--space-1)", overflowY: "auto", minHeight: 0 }}>
          {props.children}
        </div>
      )}
    </section>
  );
}

/** Dry empty state for one nav section: geometric mark + one .meta line. */
function NavEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", padding: "var(--space-1) 0" }}>
      <GeometricMark size={28} />
      <p className="meta" style={{ margin: 0, fontSize: "0.66rem", lineHeight: 1.6 }}>{children}</p>
    </div>
  );
}

/** Guess the import content type from the extension (unchanged). */
function guessType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  };
  return map[ext ?? ""] ?? "application/octet-stream";
}

export function SourceNavigator(props: {
  notebookId: string;
  sources: Source[];
  ui: NotebookUiState;
  update: (patch: Partial<NotebookUiState> | ((prev: NotebookUiState) => Partial<NotebookUiState>)) => void;
  openSource: (sourceId: string) => void;
  openNote: (noteId: string) => void;
  openCalculations: () => void;
  openMaterials: () => void;
  /** Open the evidence matrix (claims x selected sources) in the center. */
  openMatrix: () => void;
  selectClaim: (claimId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [urlInput, setUrlInput] = useState("");
  const sectionOpen = (id: string, fallback: boolean) => props.ui.sectionsOpen[id] ?? fallback;
  const toggle = (id: string, current: boolean) =>
    props.update((prev) => ({ sectionsOpen: { ...prev.sectionsOpen, [id]: !current } }));

  const importFile = useMutation({
    mutationFn: async () => {
      const picked = await pickFile();
      if (!picked) throw new Error(t("errors.noFileNav"));
      return desktopApi.importFile(picked.path, props.notebookId, picked.name, guessType(picked.name));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources", props.notebookId] }),
  });
  const importUrl = useMutation({
    mutationFn: (url: string) => desktopApi.importUrl(props.notebookId, url),
    onSuccess: () => {
      setUrlInput("");
      queryClient.invalidateQueries({ queryKey: ["sources", props.notebookId] });
    },
  });
  // Collection data: same query keys the old tabs used - the TanStack cache
  // stays shared with center/inspector consumers.
  const notes = useQuery({ queryKey: ["notes", props.notebookId], queryFn: () => desktopApi.listNotes(props.notebookId) });
  const claims = useQuery({ queryKey: ["claims", props.notebookId], queryFn: () => desktopApi.listClaims(props.notebookId) });
  const materials = useQuery({
    queryKey: ["materials", props.notebookId],
    queryFn: () => desktopApi.listMaterials(props.notebookId),
    refetchInterval: (q) => q.state.data?.some((m) => m.status === "pending" || m.status === "generating") ? 3000 : false,
  });
  const calcs = useQuery({ queryKey: ["calculations", props.notebookId], queryFn: () => desktopApi.listCalculations(props.notebookId) });

  return (
    <div className="workspace-nav" style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)", minHeight: 0, flex: 1, overflow: "hidden" }}>
      <Section id="sources" index="01" title={t("nav.sources")} count={props.sources.length}
        open={sectionOpen("sources", true)} onToggle={() => toggle("sources", sectionOpen("sources", true))}>
        <button className="primary" onClick={() => importFile.mutate()} disabled={importFile.isPending}>
          {importFile.isPending ? t("common.importing") : t("nav.addSource")}
        </button>
        {importFile.isError && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{importFile.error.message}</p>}
        <form onSubmit={(e) => { e.preventDefault(); if (urlInput.trim() && !importUrl.isPending) importUrl.mutate(urlInput.trim()); }}
          style={{ display: "flex", gap: "var(--space-1)" }}>
          <input type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://…" aria-label={t("nav.urlAria")} disabled={importUrl.isPending} />
          <button type="submit" disabled={!urlInput.trim() || importUrl.isPending}>{importUrl.isPending ? t("common.importing") : t("nav.urlButton")}</button>
        </form>
        {importUrl.data?.deduped && <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>{t("nav.deduped")}</p>}
        {importUrl.isError && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{importUrl.error.message}</p>}
        {props.sources.length === 0 ? (
          <NavEmpty>{t("nav.noSources")}</NavEmpty>
        ) : (
          <ul role="list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column" }}>
            {props.sources.map((s, i) => (
              <SourceRow key={s._id} source={s} index={i} last={i === props.sources.length - 1} notebookId={props.notebookId}
                selected={props.ui.selectedSourceId === s._id} onOpen={() => props.openSource(s._id)} />
            ))}
          </ul>
        )}
      </Section>
      <Section id="notes" index="02" title={t("nav.notes")} count={(notes.data ?? []).length}
        open={sectionOpen("notes", true)} onToggle={() => toggle("notes", sectionOpen("notes", true))}>
        <NoteCreateForm notebookId={props.notebookId} onCreated={(id) => props.openNote(id)} />
        {(notes.data ?? []).length === 0 ? (
          <NavEmpty>{t("nav.noNotes")}</NavEmpty>
        ) : (
          <ul role="list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column" }}>
            {(notes.data ?? []).map((n, i) => (
              <li key={n._id} style={{ borderBottom: i === (notes.data ?? []).length - 1 ? undefined : "1px solid var(--rule)" }}>
                <button onClick={() => props.openNote(n._id)} title={n.title}
                  aria-current={props.ui.selectedNoteId === n._id ? "true" : undefined}
                  style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) 0", minHeight: 32,
                    background: "transparent", color: "inherit", border: "none",
                    borderLeft: `2px solid ${props.ui.selectedNoteId === n._id ? "var(--ink)" : "transparent"}` }}>
                  <span className="mono" style={{ fontSize: "0.68rem" }}>{twoDigits(i)}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontSize: "0.85rem", fontWeight: props.ui.selectedNoteId === n._id ? 600 : 400 }}>{n.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="claims" index="03" title={t("nav.claims")} count={(claims.data ?? []).length}
        open={sectionOpen("claims", true)} onToggle={() => toggle("claims", sectionOpen("claims", true))}>
        <ClaimCreateForm notebookId={props.notebookId} />
        <button onClick={props.openMatrix} title={t("nav.openMatrixTitle")}>{t("nav.openMatrix")}</button>
        {(claims.data ?? []).length === 0 ? (
          <NavEmpty>{t("nav.noClaims")}</NavEmpty>
        ) : (
          <ul role="list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {(claims.data ?? []).map((c, i) => (
              <li key={c._id}>
                <button onClick={() => props.selectClaim(c._id)} title={c.text}
                  aria-current={props.ui.selectedClaimId === c._id ? "true" : undefined}
                  style={{ width: "100%", textAlign: "left", fontSize: "0.85rem", display: "flex", flexDirection: "column", gap: "var(--space-1)",
                    padding: "var(--space-2)",
                    background: props.ui.selectedClaimId === c._id ? "var(--surface-subtle)" : "transparent", color: "inherit",
                    border: "2px solid var(--ink)" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <span className="mono" style={{ fontSize: "0.7rem" }}>{twoDigits(i)}</span>
                    <span style={{ flex: 1 }} />
                    <ClaimChips claim={c} />
                  </span>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.text}</span>
                  <span className="meta" style={{ fontSize: "0.62rem" }}>{c.origin === "chat" ? t("settings.typeChat") : t("nav.originManual")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="calcs" index="04" title={t("nav.calcs")} count={(calcs.data ?? []).length}
        open={sectionOpen("calcs", true)} onToggle={() => toggle("calcs", sectionOpen("calcs", true))}>
        {(calcs.data ?? []).length === 0 ? (
          <NavEmpty>{t("nav.noCalcs")}</NavEmpty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {(calcs.data ?? []).slice(-3).reverse().map((c, i, arr) => (
              <div key={c.id} style={{ fontSize: "0.8rem", display: "flex", justifyContent: "space-between", gap: "var(--space-2)", alignItems: "baseline", padding: "var(--space-1) 0", borderBottom: i === arr.length - 1 ? undefined : "1px solid var(--rule)" }}>
                <span className="mono" style={{ fontSize: "0.66rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.operation}</span>
                <strong style={{ fontFamily: "var(--font-mono)" }}>{c.result ?? c.error}</strong>
              </div>
            ))}
          </div>
        )}
        <button onClick={props.openCalculations}>{t("nav.openCalcs")}</button>
      </Section>
      <Section id="materials" index="05" title={t("nav.materials")} count={(materials.data ?? []).length}
        open={sectionOpen("materials", true)} onToggle={() => toggle("materials", sectionOpen("materials", true))}>
        {(materials.data ?? []).length === 0 ? (
          <NavEmpty>{t("nav.noMaterials")}</NavEmpty>
        ) : (
          <ul role="list" style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column" }}>
            {(materials.data ?? []).map((m, i) => (
              <li key={m._id} style={{ fontSize: "0.85rem", padding: "var(--space-1) 0", borderBottom: i === (materials.data ?? []).length - 1 ? undefined : "1px solid var(--rule)" }}>
                <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "baseline" }}>
                  <span className="mono" style={{ fontSize: "0.68rem" }}>{twoDigits(i)}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.type}</span>
                  <span className="meta" style={{ fontSize: "0.62rem" }}>
                    {m.status === "completed" ? t("nav.matDone") : m.status === "error" ? t("common.error") : t("nav.matRunning")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button onClick={props.openMaterials}>{t("nav.openMaterials")}</button>
      </Section>
    </div>
  );
}

/** One source row as an archive-index entry: two-digit mono index, file name
 *  in medium weight, status chip right; hairline separators between rows
 *  only (no card boxes). The selected record gets the ink side rule. */
function SourceRow({ source, index, last, selected, notebookId, onOpen }: { source: Source; index: number; last: boolean; selected: boolean; notebookId: string; onOpen: () => void }) {
  return (
    <li style={{ borderBottom: last ? undefined : "1px solid var(--rule)" }}>
      <button
        onClick={onOpen}
        aria-current={selected ? "true" : undefined}
        style={{ width: "100%", textAlign: "left", border: "none", display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) 0", minHeight: 32,
          borderLeft: `2px solid ${selected ? "var(--ink)" : "transparent"}`,
          background: "transparent", color: "inherit" }}
      >
        <span className="mono" style={{ fontSize: "0.68rem" }}>{twoDigits(index)}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.85rem", fontWeight: 500 }}>{source.fileName}</span>
        <SourceStatus status={source.status} />
      </button>
      <SourceRowActions source={source} notebookId={notebookId} />
    </li>
  );
}

/** Status chip right: the neutral default (completed) stays an outline chip;
 *  outstanding states are solid status chips (words + color, never color). */
function SourceStatus({ status }: { status: string }) {
  if (status === "error") return <span className="chip" style={{ background: "var(--status-error)", color: "var(--status-error-fg)" }}>{t("common.error")}</span>;
  if (status !== "completed") return <span className="chip" style={{ background: "var(--status-warning)", color: "var(--status-warning-fg)" }}>{t("nav.processing")}</span>;
  return <span className="chip" style={{ border: "1px solid var(--rule)", color: "var(--ink-60)" }}>{t("nav.srcDone")}</span>;
}

/** Re-import as a new immutable version + the versions list (strategy 5A).
 *  Kept from the old SourceRow; the inline result states the honest outcome.
 *  The result is stored as {key, vars} so a live language switch re-renders. */
function SourceRowActions({ source, notebookId }: { source: Source; notebookId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ key: string; vars?: Record<string, string | number> } | null>(null);
  const reimport = useMutation({
    mutationFn: async () => {
      const picked = await pickFile();
      if (!picked) throw new Error(t("errors.noFileNav"));
      return desktopApi.reimportVersion(source._id, picked.path, picked.name);
    },
    onSuccess: async (r) => {
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
      queryClient.invalidateQueries({ queryKey: ["versions", source._id] });
      if (r.unchanged) {
        setResult({ key: "nav.unchanged" });
        return;
      }
      try {
        const vs = await desktopApi.listVersions(source._id);
        setResult({ key: "nav.versionProcessing", vars: { n: (vs[vs.length - 1]?.version ?? 0) + 1 } });
      } catch {
        setResult({ key: "nav.newVersionProcessing" });
      }
    },
  });
  const { data: versions } = useQuery({
    queryKey: ["versions", source._id],
    queryFn: () => desktopApi.listVersions(source._id),
    enabled: open,
    refetchInterval: open && source.status !== "completed" ? 3000 : false,
  });
  return (
    <div style={{ padding: "0 0 var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        <button style={{ fontSize: "0.75rem", padding: "0 var(--space-1)" }} disabled={reimport.isPending} onClick={() => reimport.mutate()}>
          {reimport.isPending ? t("common.importing") : t("nav.newVersion")}
        </button>
        <button style={{ fontSize: "0.75rem", padding: "0 var(--space-1)" }} aria-expanded={open} onClick={() => setOpen(!open)}>
          {t("nav.versions")}
        </button>
      </div>
      {result && <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>{t(result.key, result.vars)}</p>}
      {open && (
        <div className="rule-top" style={{ paddingTop: "var(--space-1)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {(versions ?? []).length === 0 ? (
            <span className="muted" style={{ fontSize: "0.75rem" }}>{t("nav.noVersions")}</span>
          ) : (
            (versions ?? []).map((v) => (
              <span key={v.id} className="mono" style={{ fontSize: "0.7rem" }}>
                {v.pageCount != null
                  ? t("nav.versionPages", { v: v.version, date: fmtDate(v.createdAt), n: v.pageCount })
                  : t("nav.versionCsv", { v: v.version, date: fmtDate(v.createdAt) })}
              </span>
            ))
          )}
          {source.status !== "completed" && <span className="muted" style={{ fontSize: "0.75rem" }}>{t("nav.processing")}</span>}
        </div>
      )}
      {source.status === "error" && source.errorMessage && (
        <p style={{ color: "var(--accent)", fontSize: "0.75rem", margin: 0 }}>{source.errorMessage}</p>
      )}
    </div>
  );
}

/** Status chips of one claim (non-color: the words are the state). Status =
 *  SOLID chip from the contrast-verified pairs; the neutral default stays an
 *  outline chip (hairline + secondary ink). The pending-reviews chip is the
 *  archive's outstanding-items marker. */
function ClaimChips({ claim }: { claim: ClaimView }) {
  return (
    <span style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap", alignItems: "center" }}>
      {claim.status === "reviewed" ? (
        <span className="chip" style={{ background: "var(--status-success)", color: "var(--status-success-fg)" }}>{t("nav.claimReviewed")}</span>
      ) : claim.status === "withdrawn" ? (
        <span className="chip" style={{ background: "var(--status-warning)", color: "var(--status-warning-fg)" }}>{t("nav.claimWithdrawn")}</span>
      ) : (
        <span className="chip" style={{ border: "1px solid var(--rule)", color: "var(--ink-60)" }}>{t("nav.claimActive")}</span>
      )}
      {claim.pendingReviews > 0 && (
        <span className="chip" style={{ background: "var(--status-warning)", color: "var(--status-warning-fg)" }}>
          {t("nav.openReviews", { n: claim.pendingReviews })}
        </span>
      )}
    </span>
  );
}

/** Inline note creation; the new note opens in the center editor. */
function NoteCreateForm({ notebookId, onCreated }: { notebookId: string; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => desktopApi.createNote(notebookId, title.trim(), ""),
    onSuccess: (data) => {
      setTitle("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
      onCreated(data.id);
    },
  });
  if (!open) {
    return <button onClick={() => setOpen(true)}>{t("nav.addNote")}</button>;
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (title.trim()) create.mutate(); }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <input autoFocus placeholder={t("nav.titlePlaceholder")} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("nav.noteTitleAria")} />
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        <button className="primary" type="submit" disabled={!title.trim() || create.isPending}>{create.isPending ? t("common.saving") : t("common.save")}</button>
        <button type="button" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
      </div>
      {create.isError && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{create.error.message}</p>}
    </form>
  );
}

/** Compact claim creation (was the claims tab form). */
function ClaimCreateForm({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const create = useMutation({
    mutationFn: () => desktopApi.createClaim(notebookId, text.trim()),
    onSuccess: () => {
      setText("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["claims", notebookId] });
    },
  });
  if (!open) {
    return <button onClick={() => setOpen(true)}>{t("nav.addClaim")}</button>
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) create.mutate(); }}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <textarea rows={2} placeholder={t("nav.newClaimPlaceholder")} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("nav.claimTextAria")} />
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        <button className="primary" type="submit" disabled={!text.trim() || create.isPending}>{create.isPending ? t("common.saving") : t("common.save")}</button>
        <button type="button" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
      </div>
      {create.isError && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{create.error.message}</p>}
    </form>
  );
}
