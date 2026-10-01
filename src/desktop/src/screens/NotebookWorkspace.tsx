/**
 * NotebookWorkspace (workspace redesign phase 1): the composition root.
 * Splits into WorkspaceShell (layout), SourceNavigator (left collections),
 * DocumentWorkspace (center work surface) and EvidenceInspector (right
 * evidence/actions). Data wiring stays here: sources list, job-driven
 * invalidation, the sources.open reader target, the captured selection and
 * the two save paths (claim / note insert).
 *
 * Reader open path (priority 1): every open goes through
 * sources.open {sourceId, versionId?} - no evidence anchor needed, so a
 * freshly imported source is readable immediately. "Latest" is pinned to
 * the concrete immutable version row id as soon as the open resolves, so a
 * reimport never swaps the page under an open reader or an open selection.
 *
 * Provenance (the essential v1->v2 scenario): the selection object carries
 * {sourceId, versionId, version, page, quote} frozen at capture time. Both
 * save paths use that identity AS-IS - nothing here re-resolves the
 * version, so "open v1 -> select -> publish v2 -> save" cites v1 by
 * construction. Switching source or version clears the selection; page
 * navigation within the same version keeps it.
 *
 * Note reference marker contract: "In Notiz einfügen" saves the passage as
 * an anchor-bearing claim (the durable reference) and appends to the note
 * content `> „quote" — file · vN · S. page [@claim:<claimId>]`; the
 * NoteEditor renders the markers as navigable chips (zero engine changes).
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, type ClaimAnchorView } from "../lib/api";
import { t } from "../i18n";
import { DEFAULT_UI_STATE, useNotebookUiState } from "../lib/uiState";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { SourceNavigator } from "../workspace/SourceNavigator";
import { DocumentWorkspace, type ReaderBundle } from "../workspace/DocumentWorkspace";
import { EvidenceInspector, type ReaderContext } from "../workspace/EvidenceInspector";
import type { ReaderSelection } from "../workspace/SourceReader";

export function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [ui, update] = useNotebookUiState(notebookId);
  // What the center reader has open (session state): the source plus the
  // immutable version row id (null = latest, pinned after the open).
  const [readerTarget, setReaderTarget] = useState<{ sourceId: string; versionId: string | null } | null>(null);
  // Passage captured in the reader - identity frozen at capture time.
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: sources } = useQuery({
    queryKey: ["sources", notebookId],
    queryFn: () => desktopApi.listSources(notebookId),
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.status === "pending" || s.status === "processing") ? 3000 : false,
  });

  // F4: the engine finishes imports in the background - without a ["jobs"]
  // poll the workspace never learns a source became available.
  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: desktopApi.listJobs,
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j) => !["completed", "failed", "cancelled"].includes(j.status)) ? 3000 : false,
  });
  const lastJobStatus = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const j of jobs?.jobs ?? []) {
      if (j.kind !== "import" || j.notebookId !== notebookId) continue;
      const prev = lastJobStatus.current.get(j.id);
      lastJobStatus.current.set(j.id, j.status);
      if (prev && prev !== j.status && j.status === "completed") {
        queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["claims", notebookId] });
      }
    }
  }, [jobs, notebookId, queryClient]);

  const claims = useQuery({ queryKey: ["claims", notebookId], queryFn: () => desktopApi.listClaims(notebookId) });
  const notes = useQuery({ queryKey: ["notes", notebookId], queryFn: () => desktopApi.listNotes(notebookId) });
  // Notebook title for the workspace header (same cache key as the library).
  const { data: notebooks } = useQuery({ queryKey: ["notebooks"], queryFn: desktopApi.listNotebooks });
  const notebookTitle = (notebooks ?? []).find((n) => n._id === notebookId)?.title ?? null;

  // The reader's version list (dropdown) and the open result. Keys include
  // the version id, so a pinned reader never silently refetches to a newer
  // version when a reimport lands.
  const versions = useQuery({
    queryKey: ["versions", readerTarget?.sourceId ?? ""],
    queryFn: () => desktopApi.listVersions(readerTarget!.sourceId),
    enabled: !!readerTarget,
  });
  const opened = useQuery({
    queryKey: ["source-open", readerTarget?.sourceId ?? "", readerTarget?.versionId ?? null],
    queryFn: () => desktopApi.openSource(readerTarget!.sourceId, readerTarget!.versionId ?? undefined),
    enabled: !!readerTarget,
  });
  // Row id of the OPENED version (sources.open reports the number; the
  // claim anchors and the dropdown need the immutable row id).
  const openedRowId = opened.data && versions.data
    ? versions.data.find((v) => v.version === opened.data.version)?.id ?? null
    : null;

  // Pin "latest" to the concrete row id once resolved: the reader then
  // holds an immutable version even while newer ones get imported.
  useEffect(() => {
    if (!readerTarget || readerTarget.versionId || !openedRowId) return;
    setReaderTarget({ sourceId: readerTarget.sourceId, versionId: openedRowId });
    update((prev) => ({
      sources: {
        ...prev.sources,
        [readerTarget.sourceId]: {
          versionId: openedRowId,
          page: prev.sources[readerTarget.sourceId]?.page ?? 1,
          scrollTop: prev.sources[readerTarget.sourceId]?.scrollTop ?? 0,
        },
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerTarget, openedRowId]);

  /** One open path for everything (navigator, chat citations, anchor/note
   *  chips, version dropdown): sets the reader target and remembers the
   *  position per source. Any source/version switch clears the captured
   *  selection - an out-of-context selection must not be saveable against
   *  the wrong version. */
  const openAt = (sourceId: string, versionId: string | null, page = 1) => {
    setSelection(null);
    setReaderTarget({ sourceId, versionId });
    update((prev) => ({
      selectedSourceId: sourceId,
      activeView: "source",
      sources: { ...prev.sources, [sourceId]: { versionId, page, scrollTop: 0 } },
    }));
  };

  const openSource = (sourceId: string) => {
    // Restore the last read version and page of this source; a fresh
    // source opens the latest version (pinned right after the open).
    openAt(
      sourceId,
      ui.sources[sourceId]?.versionId ?? null,
      ui.sources[sourceId]?.page ?? 1
    );
  };

  /** Follow a reference: open the stored original in the center at the
   *  anchor's version and page (D1 "Verweis folgen"). The anchor pins an
   *  immutable VERSION row - sourceVersionId maps it to its one source
   *  reliably even after a reimport renamed the source row (a fileName match
   *  alone goes stale: "kaffee-studie-v1.pdf" becomes "-v2.pdf" while the
   *  chip still cites v1). */
  const openAnchor = (a: ClaimAnchorView) => {
    void (async () => {
      let source = (sources ?? []).find((s) => s.fileName === a.fileName) ?? null;
      if (!source && a.sourceVersionId) {
        for (const s of sources ?? []) {
          const vs = await queryClient.fetchQuery({
            queryKey: ["versions", s._id],
            queryFn: () => desktopApi.listVersions(s._id),
          });
          if (vs.some((v) => v.id === a.sourceVersionId)) {
            source = s;
            break;
          }
        }
      }
      if (!source) return;
      openAtVersion(source._id, a.version, a.page);
    })();
  };

  /** Version-pinned open by NUMBER (matrix cells, anchor chips, proposal
   *  comparison): resolves the immutable row id, then routes through the one
   *  open path. A version that no longer resolves opens latest - pinned
   *  opens never guess. */
  const openAtVersion = (sourceId: string, version: number, page?: number | null) => {
    void (async () => {
      let versionId: string | null = null;
      try {
        const vs = await queryClient.fetchQuery({
          queryKey: ["versions", sourceId],
          queryFn: () => desktopApi.listVersions(sourceId),
        });
        versionId = vs.find((v) => v.version === version)?.id ?? null;
      } catch { /* version list unavailable -> open latest */ }
      openAt(sourceId, versionId, page ?? 1);
    })();
  };

  /** Note reference chips: open the claim's first anchor in the reader at
   *  ITS version; a claim without anchors just selects into the inspector. */
  const openClaimRef = (claimId: string) => {
    const anchor = (claims.data ?? []).find((c) => c._id === claimId)?.anchors[0];
    if (anchor) openAnchor(anchor);
    else update({ selectedClaimId: claimId, inspectorOpen: true });
  };

  const openNote = (noteId: string) => update({ selectedNoteId: noteId, activeView: "note" });
  const selectClaim = (claimId: string) => update({ selectedClaimId: claimId, inspectorOpen: true });

  // Restore the persisted reader on mount (view-state mandate): the saved
  // source/version/page reopen without a navigator click.
  useEffect(() => {
    if (readerTarget || !ui.selectedSourceId || ui.activeView !== "source") return;
    openAt(
      ui.selectedSourceId,
      ui.sources[ui.selectedSourceId]?.versionId ?? null,
      ui.sources[ui.selectedSourceId]?.page ?? 1
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Both save paths use the selection's frozen identity: sel.sourceId and
   * sel.versionId were captured at selection time and are used AS-IS. A
   * reimport after the selection cannot re-point the citation because
   * nothing here re-resolves the version. */
  const saveEvidence = useMutation({
    mutationFn: (sel: ReaderSelection) => desktopApi.createClaim(notebookId, sel.quote, [
      { sourceId: sel.sourceId, ...(sel.versionId ? { versionId: sel.versionId } : {}), page: sel.page, quote: sel.quote },
    ]),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["claims", notebookId] });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : String(e)),
  });

  // D1 action 2 + note references: save the passage as an anchor-bearing
  // claim (durable, navigable), then append the human-readable quote block
  // with the [@claim:<id>] marker to the target note (or a new note).
  // The block template follows the UI language; the [@claim:<id>] marker
  // itself is a fixed data format (contract-tested in src/__tests__).
  const insertIntoNote = useMutation({
    mutationFn: async (sel: ReaderSelection) => {
      const claim = await desktopApi.createClaim(notebookId, sel.quote, [
        { sourceId: sel.sourceId, ...(sel.versionId ? { versionId: sel.versionId } : {}), page: sel.page, quote: sel.quote },
      ]);
      const fileName = (sources ?? []).find((s) => s._id === sel.sourceId)?.fileName ?? t("common.sourceFallback");
      const v = sel.version != null ? `v${sel.version}` : t("note.noVersion");
      const block = `\n\n${t("note.quoteBlock", { quote: sel.quote, file: fileName, v, page: sel.page, id: claim.id })}`;
      const targetId = ui.selectedNoteId ?? (notes.data ?? [])[0]?._id ?? null;
      if (targetId) {
        const note = (notes.data ?? []).find((n) => n._id === targetId);
        if (!note) throw new Error(t("errors.noteNotFound"));
        await desktopApi.updateNote(targetId, note.title, note.content + block);
        return targetId;
      }
      const created = await desktopApi.createNote(notebookId, fileName, block.trim());
      return created.id;
    },
    onSuccess: (noteId) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["claims", notebookId] });
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
      update({ activeView: "note", selectedNoteId: noteId });
    },
    onError: (e) => setActionError(e instanceof Error ? e.message : String(e)),
  });

  const onSaveClaim = (sel: ReaderSelection) => saveEvidence.mutate(sel);
  const onInsertNote = (sel: ReaderSelection) => insertIntoNote.mutate(sel);
  const actionPending = saveEvidence.isPending || insertIntoNote.isPending;

  // What the center reader needs (one bundle, flat props).
  const readerBundle: ReaderBundle | null = readerTarget ? {
    sourceId: readerTarget.sourceId,
    versionId: openedRowId ?? readerTarget.versionId,
    opened: opened.data ?? null,
    openError: opened.isError ? (opened.error instanceof Error ? opened.error.message : String(opened.error)) : null,
    versions: versions.data,
  } : null;

  // What the inspector needs about the reader (identity from the open
  // call, never from an anchor) plus the frozen selection.
  const readerSource = (sources ?? []).find((s) => s._id === readerTarget?.sourceId) ?? null;
  const readerContext: ReaderContext | null = readerTarget && readerSource ? {
    sourceId: readerTarget.sourceId,
    fileName: readerSource.fileName,
    versionId: openedRowId,
    version: opened.data?.version ?? null,
    selection,
  } : null;

  return (
    <WorkspaceShell
      navWidth={ui.navWidth}
      inspectorWidth={ui.inspectorWidth}
      onNavWidth={(w) => update({ navWidth: w })}
      onInspectorWidth={(w) => update({ inspectorWidth: w })}
      inspectorOpen={ui.inspectorOpen}
      navDrawerOpen={ui.navDrawerOpen}
      onCloseInspector={() => update({ inspectorOpen: false })}
      onCloseNavDrawer={() => update({ navDrawerOpen: false })}
      nav={
        <SourceNavigator
          notebookId={notebookId}
          sources={sources ?? []}
          ui={ui}
          update={update}
          openSource={openSource}
          openNote={openNote}
          openCalculations={() => update({ activeView: "calculations" })}
          openMaterials={() => update({ activeView: "materials" })}
          openMatrix={() => update({ activeView: "matrix" })}
          selectClaim={selectClaim}
        />
      }
      center={
        <DocumentWorkspace
          notebookId={notebookId}
          notebookTitle={notebookTitle}
          sources={sources ?? []}
          ui={ui}
          update={update}
          reader={readerBundle}
          onReaderSelect={setSelection}
          onOpenVersion={(versionId) => { if (readerTarget) openAt(readerTarget.sourceId, versionId); }}
          onSaveClaim={onSaveClaim}
          onInsertNote={onInsertNote}
          onOpenClaimRef={openClaimRef}
          onResetLayout={() => update({ navWidth: DEFAULT_UI_STATE.navWidth, inspectorWidth: DEFAULT_UI_STATE.inspectorWidth })}
          onToggleInspector={() => update((prev) => ({ inspectorOpen: !prev.inspectorOpen }))}
          onToggleNav={() => update({ navDrawerOpen: true })}
          openSource={openSource}
          openAtVersion={openAtVersion}
          onSelectClaim={selectClaim}
        />
      }
      inspector={
        <EvidenceInspector
          notebookId={notebookId}
          sources={sources ?? []}
          ui={ui}
          update={update}
          reader={readerContext}
          openAnchor={openAnchor}
          openVersion={openAtVersion}
          onSaveClaim={onSaveClaim}
          onInsertNote={onInsertNote}
          actionError={actionError}
          actionPending={actionPending}
        />
      }
    />
  );
}
