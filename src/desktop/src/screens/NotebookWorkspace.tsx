/**
 * NotebookWorkspace (workspace redesign phase 1): the composition root.
 * Splits into WorkspaceShell (layout), SourceNavigator (left collections),
 * DocumentWorkspace (center work surface) and EvidenceInspector (right
 * evidence/actions). Data wiring stays here: sources list, job-driven
 * invalidation, the opened reader anchor and the captured selection.
 *
 * Opening a source uses the only path the engine offers: an evidence anchor
 * (evidence.open). If a source has no anchored claim yet, the reader shows
 * the honest gap (missing sources.open op) instead of faking a viewer.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, type ClaimAnchorView } from "../lib/api";
import { DEFAULT_UI_STATE, useNotebookUiState } from "../lib/uiState";
import { WorkspaceShell } from "../workspace/WorkspaceShell";
import { SourceNavigator } from "../workspace/SourceNavigator";
import { DocumentWorkspace } from "../workspace/DocumentWorkspace";
import { EvidenceInspector, type ReaderContext } from "../workspace/EvidenceInspector";

export function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [ui, update] = useNotebookUiState(notebookId);
  // The anchor the center reader was opened with (session state).
  const [readerAnchor, setReaderAnchor] = useState<ClaimAnchorView | null>(null);
  // Passage captured in the reader (session state; cleared on page change).
  const [selection, setSelection] = useState<{ page: number; quote: string } | null>(null);

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

  // A source opens through its first anchored claim (fileName join - anchors
  // carry no sourceId over the wire today).
  const anchorForSource = (sourceId: string): ClaimAnchorView | null => {
    const source = (sources ?? []).find((s) => s._id === sourceId);
    if (!source) return null;
    for (const c of claims.data ?? []) {
      const hit = c.anchors.find((a) => a.fileName === source.fileName);
      if (hit) return hit;
    }
    return null;
  };

  const openSource = (sourceId: string) => {
    update({ selectedSourceId: sourceId, activeView: "source" });
    setReaderAnchor(anchorForSource(sourceId));
    setSelection(null);
  };

  /** Follow a reference: open the stored original in the center at the
   *  anchor's version and page (D1 "Verweis folgen"). */
  const openAnchor = (a: ClaimAnchorView) => {
    const source = (sources ?? []).find((s) => s.fileName === a.fileName);
    if (source) {
      update((prev) => ({
        selectedSourceId: source._id,
        activeView: "source",
        sources: { ...prev.sources, [source._id]: { ...(prev.sources[source._id] ?? { versionId: null, page: 1, scrollTop: 0 }), page: a.page ?? 1 } },
      }));
      setReaderAnchor(a);
      setSelection(null);
    }
  };

  const openNote = (noteId: string) => update({ selectedNoteId: noteId, activeView: "note" });
  const selectClaim = (claimId: string) => update({ selectedClaimId: claimId, inspectorOpen: true });

  // What the inspector needs about the reader (evidence + selection).
  const readerContext: ReaderContext | null = (() => {
    const source = (sources ?? []).find((s) => s._id === ui.selectedSourceId);
    if (!source) return null;
    return {
      sourceId: source._id,
      fileName: source.fileName,
      version: readerAnchor?.version ?? null,
      selection,
    };
  })();

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
          selectClaim={selectClaim}
        />
      }
      center={
        <DocumentWorkspace
          notebookId={notebookId}
          sources={sources ?? []}
          ui={ui}
          update={update}
          readerAnchor={readerAnchor}
          onReaderSelect={setSelection}
          onResetLayout={() => update({ navWidth: DEFAULT_UI_STATE.navWidth, inspectorWidth: DEFAULT_UI_STATE.inspectorWidth })}
          onToggleInspector={() => update((prev) => ({ inspectorOpen: !prev.inspectorOpen }))}
          onToggleNav={() => update({ navDrawerOpen: true })}
          openSource={openSource}
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
        />
      }
    />
  );
}
