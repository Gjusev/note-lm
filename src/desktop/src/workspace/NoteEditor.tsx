/**
 * NoteEditor (workspace redesign): the center note work surface. Drafts
 * persist per note id in the notebook UI state (mandate 3), saved content
 * goes through notes.update; the title only. Quote blocks inserted from the
 * inspector ("In Notiz einfügen") land here via the UI-state flow.
 *
 * Note reference markers (priority 1, marker contract): note content may
 * embed `[@claim:<claimId>]` markers - "In Notiz einfügen" writes one next
 * to each human-readable quote block (see NotebookWorkspace for the insert
 * side). The editor content stays raw text; the markers render as
 * navigable chips in the "Verweise" strip below: clicking a chip opens the
 * claim's anchor in the center reader at ITS pinned version. The claim row
 * is the durable reference - zero engine changes.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi } from "../lib/api";
import { t } from "../i18n";
import type { NotebookUiState } from "../lib/uiState";

/** `[@claim:<claimId>]` - ids are engine row ids ([A-Za-z0-9_-]+). */
const CLAIM_REF_PATTERN = /\[@claim:([A-Za-z0-9_-]+)\]/g;

/** Parse [@claim:<id>] markers (deduped, in order of first appearance).
 *  Exported for the contract test in src/__tests__: the format spans two
 *  files - written by NotebookWorkspace's insert path, parsed here - and
 *  must not drift silently. */
export function parseClaimRefs(content: string): string[] {
  const ids: string[] = [];
  for (const m of content.matchAll(CLAIM_REF_PATTERN)) {
    const id = m[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function NoteEditor(props: {
  notebookId: string;
  noteId: string;
  ui: NotebookUiState;
  update: (patch: Partial<NotebookUiState> | ((prev: NotebookUiState) => Partial<NotebookUiState>)) => void;
  /** Open a claim reference chip in the center reader (composition root). */
  onOpenClaimRef: (claimId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: note } = useQuery({
    queryKey: ["notes", props.notebookId],
    queryFn: () => desktopApi.listNotes(props.notebookId),
    select: (rows) => rows.find((n) => n._id === props.noteId),
  });

  // Draft wins over the persisted content until saved (or discarded).
  const draft = props.ui.drafts[props.noteId] ?? note?.content ?? "";

  // Title keeps a local edit state; the CONTENT draft persists across view
  // switches (ui.drafts). An unsaved title edit is lost on switching - a
  // small honest gap, content is what matters.
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => { if (note) setTitle((prev) => prev ?? note.title); }, [note]);

  const save = useMutation({
    mutationFn: () => desktopApi.updateNote(props.noteId, title ?? "", draft),
    onSuccess: () => {
      props.update((prev) => {
        const drafts = { ...prev.drafts };
        delete drafts[props.noteId];
        return { drafts };
      });
      queryClient.invalidateQueries({ queryKey: ["notes", props.notebookId] });
    },
  });

  const claimIds = useMemo(() => parseClaimRefs(draft), [draft]);

  const setContent = (v: string) =>
    props.update((prev) => ({ drafts: { ...prev.drafts, [props.noteId]: v } }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "var(--space-4)", gap: "var(--space-2)", overflowY: "auto" }}>
      <input value={title ?? ""} onChange={(e) => setTitle(e.target.value)} aria-label={t("nav.noteTitleAria")} placeholder={t("nav.titlePlaceholder")}
        style={{ fontSize: "1.1rem", fontWeight: 600, border: "none", background: "transparent", padding: "var(--space-1) 0" }} />
      <textarea value={draft} onChange={(e) => setContent(e.target.value)} aria-label={t("note.contentAria")}
        style={{ flex: 1, minHeight: 240, resize: "none", fontFamily: "var(--font-ui)", fontSize: "0.95rem", lineHeight: 1.6 }} />
      {claimIds.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <span className="mono" style={{ fontSize: "0.7rem" }}>{t("note.refsTitle")}</span>
          <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
            {claimIds.map((id) => (
              <ClaimRefChip key={id} notebookId={props.notebookId} claimId={id} onOpen={props.onOpenClaimRef} />
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <button className="primary" disabled={save.isPending || !title?.trim()} onClick={() => save.mutate()}>
          {save.isPending ? t("common.saving") : t("common.save")}
        </button>
        {props.ui.drafts[props.noteId] != null && <span className="muted" style={{ fontSize: "0.8rem" }}>{t("note.draftUnsaved")}</span>}
      </div>
      {save.isError && <p role="alert" style={{ color: "var(--accent)", margin: 0, fontSize: "0.8rem" }}>{save.error.message}</p>}
    </div>
  );
}

/** One navigable note reference: resolves [@claim:<id>] to the claim's
 *  first anchor; clicking re-opens that anchor's original in the reader at
 *  the anchor's own version. Unknown ids (deleted claim) degrade honestly. */
function ClaimRefChip({ notebookId, claimId, onOpen }: { notebookId: string; claimId: string; onOpen: (claimId: string) => void }) {
  const { data: claims } = useQuery({ queryKey: ["claims", notebookId], queryFn: () => desktopApi.listClaims(notebookId) });
  const anchor = (claims ?? []).find((c) => c._id === claimId)?.anchors[0];
  if (!anchor && claims != null) {
    return (
      <span className="muted" style={{ fontSize: "0.75rem", border: "1px dashed var(--rule)", padding: "0 var(--space-1)" }}>
        {t("note.unknownRef")}
      </span>
    );
  }
  if (!anchor) return null;
  return (
    <button title={anchor.quote} onClick={() => onOpen(claimId)}
      style={{ fontSize: "0.75rem", padding: 0, textAlign: "left",
        background: "transparent", color: "inherit", border: "none", textDecoration: "underline" }}>
      {anchor.page != null
        ? t("note.refChipPage", { file: anchor.fileName ?? t("common.sourceFallback"), v: anchor.version, p: anchor.page })
        : t("note.refChip", { file: anchor.fileName ?? t("common.sourceFallback"), v: anchor.version })}
    </button>
  );
}
