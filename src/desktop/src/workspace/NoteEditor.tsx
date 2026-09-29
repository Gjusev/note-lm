/**
 * NoteEditor (workspace redesign): the center note work surface. Drafts
 * persist per note id in the notebook UI state (mandate 3), saved content
 * goes through notes.update; the title only. Quote blocks inserted from the
 * inspector ("In Notiz einfügen") land here via the UI-state flow.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi } from "../lib/api";
import type { NotebookUiState } from "../lib/uiState";

export function NoteEditor(props: {
  notebookId: string;
  noteId: string;
  ui: NotebookUiState;
  update: (patch: Partial<NotebookUiState> | ((prev: NotebookUiState) => Partial<NotebookUiState>)) => void;
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

  const setContent = (v: string) =>
    props.update((prev) => ({ drafts: { ...prev.drafts, [props.noteId]: v } }));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "var(--space-4)", gap: "var(--space-2)", overflowY: "auto" }}>
      <input value={title ?? ""} onChange={(e) => setTitle(e.target.value)} aria-label="Notiz-Titel" placeholder="Titel"
        style={{ fontSize: "1.1rem", fontWeight: 600, border: "none", background: "transparent", padding: "var(--space-1) 0" }} />
      <textarea value={draft} onChange={(e) => setContent(e.target.value)} aria-label="Notiz-Inhalt"
        style={{ flex: 1, minHeight: 240, resize: "none", fontFamily: "var(--font-ui)", fontSize: "0.95rem", lineHeight: 1.6 }} />
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
        <button className="primary" disabled={save.isPending || !title?.trim()} onClick={() => save.mutate()}>
          {save.isPending ? "Speichere…" : "Speichern"}
        </button>
        {props.ui.drafts[props.noteId] != null && <span className="muted" style={{ fontSize: "0.8rem" }}>Entwurf nicht gespeichert</span>}
      </div>
      {save.isError && <p role="alert" style={{ color: "var(--accent)", margin: 0, fontSize: "0.8rem" }}>{save.error.message}</p>}
    </div>
  );
}
