/**
 * DocumentWorkspace (workspace redesign): the center work surface. A small
 * view strip (old tab labels kept as views) plus the active view: source
 * reader, note editor, chat, calculations, materials. "Layout
 * zurücksetzen" resets the persisted column widths; the inspector
 * toggle stays reachable on every width.
 */
import { type ClaimAnchorView, type Source } from "../lib/api";
import { SourceReader, type ReaderSelection } from "./SourceReader";
import { NoteEditor } from "./NoteEditor";
import { ChatView } from "./ChatView";
import { CalcPanel, MaterialsPanel } from "./CenterPanels";
import type { CenterView, NotebookUiState } from "../lib/uiState";

const VIEW_LABELS: Record<CenterView, string> = {
  source: "Quelle",
  note: "Notiz",
  chat: "Chat",
  calculations: "Berechnungen",
  materials: "Materialien",
};

export function DocumentWorkspace(props: {
  notebookId: string;
  sources: Source[];
  ui: NotebookUiState;
  update: (patch: Partial<NotebookUiState> | ((prev: NotebookUiState) => Partial<NotebookUiState>)) => void;
  readerAnchor: ClaimAnchorView | null;
  onReaderSelect: (sel: ReaderSelection | null) => void;
  onResetLayout: () => void;
  onToggleInspector: () => void;
  onToggleNav: () => void;
  openSource: (sourceId: string) => void;
}) {
  const view = props.ui.activeView;
  const setView = (v: CenterView) => props.update({ activeView: v });
  const selectedSource = props.sources.find((s) => s._id === props.ui.selectedSourceId) ?? null;
  const sourceUi = props.ui.selectedSourceId ? props.ui.sources[props.ui.selectedSourceId] : undefined;

  // Center tab strip: the three main views always; calculations/materials
  // appear while their view is active (opened from the navigator).
  const tabs: CenterView[] = view === "calculations" || view === "materials"
    ? ["source", "note", "chat", view]
    : ["source", "note", "chat"];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, minWidth: 0 }}>
      <div className="rule-top" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-1) var(--space-3)", borderBottom: "1px solid var(--rule)" }}>
        <div role="tablist" aria-label="Arbeitsansicht" style={{ display: "flex", gap: "var(--space-1)" }}>
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={view === t}
              onClick={() => setView(t)}
              style={{
                border: "none", fontSize: "0.85rem", padding: "var(--space-1) var(--space-2)",
                fontWeight: view === t ? 700 : 400,
                color: view === t ? "var(--accent)" : "inherit",
                borderBottom: view === t ? "2px solid var(--accent)" : "2px solid transparent",
                borderRadius: 0,
              }}>
              {VIEW_LABELS[t]}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button style={{ fontSize: "0.8rem", padding: "0 var(--space-2)" }} aria-pressed={props.ui.navDrawerOpen} onClick={props.onToggleNav}>
          Navigation
        </button>
        <button style={{ fontSize: "0.8rem", padding: "0 var(--space-2)" }} onClick={props.onResetLayout} title="Spaltenbreiten zurücksetzen">
          Layout zurücksetzen
        </button>
        <button style={{ fontSize: "0.8rem", padding: "0 var(--space-2)" }} aria-pressed={props.ui.inspectorOpen} onClick={props.onToggleInspector}>
          Inspector
        </button>
      </div>
      {view === "source" && (
        selectedSource ? (
          <SourceReader
            key={props.readerAnchor?.id ?? "no-anchor"}
            source={selectedSource}
            anchor={props.readerAnchor}
            page={sourceUi?.page ?? 1}
            scrollTop={sourceUi?.scrollTop ?? 0}
            onPosition={(patch) => props.update((prev) => ({
              sources: { ...prev.sources, [selectedSource._id]: { versionId: null, page: patch.page ?? prev.sources[selectedSource._id]?.page ?? 1, scrollTop: patch.scrollTop ?? prev.sources[selectedSource._id]?.scrollTop ?? 0 } },
            }))}
            onSelect={props.onReaderSelect}
          />
        ) : (
          <p className="muted" style={{ padding: "var(--space-6)", fontSize: "0.9rem" }}>
            Wähle links eine Quelle, um sie hier zu öffnen.
          </p>
        )
      )}
      {view === "note" && (
        props.ui.selectedNoteId ? (
          <NoteEditor notebookId={props.notebookId} noteId={props.ui.selectedNoteId} ui={props.ui} update={props.update} />
        ) : (
          <p className="muted" style={{ padding: "var(--space-6)", fontSize: "0.9rem" }}>Wähle links eine Notiz.</p>
        )
      )}
      {view === "chat" && (
        <ChatView notebookId={props.notebookId} sources={props.sources} ui={props.ui} update={props.update} openSource={props.openSource} />
      )}
      {view === "calculations" && <CalcPanel notebookId={props.notebookId} sources={props.sources} />}
      {view === "materials" && <MaterialsPanel notebookId={props.notebookId} />}
    </div>
  );
}
