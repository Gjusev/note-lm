/**
 * DocumentWorkspace (workspace redesign): the center work surface. A small
 * view strip (old tab labels kept as views) plus the active view: source
 * reader, note editor, chat, calculations, materials. "Layout
 * zurücksetzen" resets the persisted column widths; the inspector
 * toggle stays reachable on every width.
 */
import { type Source, type SourceOpenView, type SourceVersionView } from "../lib/api";
import { t } from "../i18n";
import { SourceReader, type ReaderSelection } from "./SourceReader";
import { NoteEditor } from "./NoteEditor";
import { ChatView } from "./ChatView";
import { CalcPanel, MaterialsPanel } from "./CenterPanels";
import { MatrixView } from "./MatrixView";
import type { CenterView, NotebookUiState } from "../lib/uiState";

/** Center view tab labels (translation keys; nav.* doubles as the label). */
const VIEW_LABELS: Record<CenterView, string> = {
  source: "nav.sources",
  note: "nav.notes",
  chat: "settings.typeChat",
  calculations: "nav.calcs",
  materials: "nav.materials",
  matrix: "doc.viewMatrix",
};

/** Mono index each view tab carries (numerals are language-neutral). */
const VIEW_INDEX: Record<CenterView, string> = {
  source: "01",
  note: "02",
  chat: "03",
  calculations: "04",
  materials: "05",
  matrix: "06",
};

/** What the composition root resolved for the open reader: the target
 *  version, the sources.open result, its error and the version list for
 *  the dropdown. Passed as one object to keep the prop surface flat. */
export interface ReaderBundle {
  sourceId: string;
  versionId: string | null;
  opened: SourceOpenView | null;
  openError: string | null;
  versions: SourceVersionView[] | undefined;
}

export function DocumentWorkspace(props: {
  notebookId: string;
  notebookTitle: string | null;
  sources: Source[];
  ui: NotebookUiState;
  update: (patch: Partial<NotebookUiState> | ((prev: NotebookUiState) => Partial<NotebookUiState>)) => void;
  reader: ReaderBundle | null;
  onReaderSelect: (sel: ReaderSelection | null) => void;
  onOpenVersion: (versionId: string | null) => void;
  onSaveClaim: (sel: ReaderSelection) => void;
  onInsertNote: (sel: ReaderSelection) => void;
  onOpenClaimRef: (claimId: string) => void;
  onResetLayout: () => void;
  onToggleInspector: () => void;
  onToggleNav: () => void;
  openSource: (sourceId: string) => void;
  /** Version-pinned open for the evidence matrix (anchor and proposal
   *  versions) - routes through the same reader path as everything else. */
  openAtVersion: (sourceId: string, version: number, page?: number | null) => void;
  /** Select a claim into the inspector (matrix cells: decision UI), without
   *  opening anything in the reader. */
  onSelectClaim: (claimId: string) => void;
}) {
  const view = props.ui.activeView;
  const setView = (v: CenterView) => props.update({ activeView: v });
  const selectedSource = props.sources.find((s) => s._id === props.ui.selectedSourceId) ?? null;
  const sourceUi = props.ui.selectedSourceId ? props.ui.sources[props.ui.selectedSourceId] : undefined;

  // Center tab strip: the three main views always; calculations/materials/
  // matrix appear while their view is active (opened from the navigator).
  const transient: CenterView[] = ["calculations", "materials", "matrix"];
  const tabs: CenterView[] = transient.includes(view)
    ? ["source", "note", "chat", view]
    : ["source", "note", "chat"];

  return (
    <div className="document-workspace" style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, minWidth: 0 }}>
      <div className="rule-top workspace-toolbar" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-1) var(--space-3)", borderBottom: "1px solid var(--rule)" }}>
        <h2 title={props.notebookTitle ?? undefined} style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.03em", textTransform: "uppercase", lineHeight: 1.1, maxWidth: 460, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 auto" }}>
          {props.notebookTitle}
        </h2>
        <div className="workspace-tabs" role="tablist" aria-label={t("doc.tabsAria")} style={{ display: "flex", gap: "var(--space-1)" }}>
          {tabs.map((v) => (
            <button key={v} role="tab" aria-selected={view === v}
              onClick={() => setView(v)}
              style={{
                border: "none", fontSize: "0.85rem", padding: "var(--space-1) var(--space-2)",
                fontWeight: view === v ? 700 : 400,
                background: "transparent", color: "inherit",
                borderBottom: view === v ? "2px solid var(--ink)" : "2px solid transparent",
                borderRadius: 0,
              }}>
              <span className="mono" style={{ fontSize: "0.6rem", marginRight: "var(--space-1)", color: "var(--ink-60)" }}>{VIEW_INDEX[v]}</span>
              {t(VIEW_LABELS[v])}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button className="workspace-toolbar-action" style={{ fontSize: "0.8rem", padding: "0 var(--space-2)", whiteSpace: "nowrap" }} aria-pressed={props.ui.navDrawerOpen} onClick={props.onToggleNav}>
          {t("shell.navTitle")}
        </button>
        <button style={{ fontSize: "0.8rem", padding: "0 var(--space-2)", whiteSpace: "nowrap" }} onClick={props.onResetLayout} title={t("doc.resetLayoutTitle")}>
          {t("doc.resetLayout")}
        </button>
        <button className="workspace-toolbar-action" style={{ fontSize: "0.8rem", padding: "0 var(--space-2)", whiteSpace: "nowrap" }} aria-pressed={props.ui.inspectorOpen} onClick={props.onToggleInspector}>
          {t("shell.inspector")}
        </button>
      </div>
      {view === "source" && (
        selectedSource ? (
          <SourceReader
            key={`${selectedSource._id}:${props.reader?.versionId ?? "latest"}`}
            source={selectedSource}
            openVersionId={props.reader?.versionId ?? null}
            opened={props.reader?.opened ?? null}
            openError={props.reader?.openError ?? null}
            versions={props.reader?.versions}
            page={sourceUi?.page ?? 1}
            scrollTop={sourceUi?.scrollTop ?? 0}
            onPosition={(patch) => props.update((prev) => ({
              sources: { ...prev.sources, [selectedSource._id]: {
                versionId: prev.sources[selectedSource._id]?.versionId ?? null,
                page: patch.page ?? prev.sources[selectedSource._id]?.page ?? 1,
                scrollTop: patch.scrollTop ?? prev.sources[selectedSource._id]?.scrollTop ?? 0 } },
            }))}
            onSelect={props.onReaderSelect}
            onOpenVersion={props.onOpenVersion}
            onSaveClaim={props.onSaveClaim}
            onInsertNote={props.onInsertNote}
          />
        ) : (
          <p className="meta" style={{ padding: "var(--space-6)", fontSize: "0.68rem", lineHeight: 1.6 }}>
            {t("doc.pickSource")}
          </p>
        )
      )}
      {view === "note" && (
        props.ui.selectedNoteId ? (
          <NoteEditor notebookId={props.notebookId} noteId={props.ui.selectedNoteId} ui={props.ui} update={props.update} onOpenClaimRef={props.onOpenClaimRef} />
        ) : (
          <p className="meta" style={{ padding: "var(--space-6)", fontSize: "0.68rem", lineHeight: 1.6 }}>{t("doc.pickNote")}</p>
        )
      )}
      {view === "chat" && (
        <ChatView notebookId={props.notebookId} sources={props.sources} ui={props.ui} update={props.update} openSource={props.openSource} />
      )}
      {view === "calculations" && <CalcPanel notebookId={props.notebookId} sources={props.sources} />}
      {view === "materials" && <MaterialsPanel notebookId={props.notebookId} />}
      {view === "matrix" && (
        <MatrixView
          notebookId={props.notebookId}
          sources={props.sources}
          openAtVersion={props.openAtVersion}
          onSelectClaim={props.onSelectClaim}
        />
      )}
    </div>
  );
}
