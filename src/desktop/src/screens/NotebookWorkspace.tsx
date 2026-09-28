import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, pickFile } from "../lib/api";

/** Workspace: sources left, chat center, notes right. Panels collapse on
 *  narrow windows (plan B4) — tabs at <900px via CSS. */
export function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"sources" | "notes">("sources");

  const { data: sources } = useQuery({
    queryKey: ["sources", notebookId],
    queryFn: () => desktopApi.listSources(notebookId),
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.status === "pending" || s.status === "processing") ? 3000 : false,
  });

  const importFile = useMutation({
    mutationFn: async () => {
      const picked = await pickFile();
      if (!picked) throw new Error("Keine Datei gewählt (Dialog nur im Desktop-Fenster verfügbar)");
      return desktopApi.importFile(picked.path, notebookId, picked.name, guessType(picked.name));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources", notebookId] }),
  });

  return (
    <div style={{ display: "flex", width: "100%", minHeight: 0 }}>
      <aside
        style={{
          width: "300px",
          borderRight: "1px solid var(--rule)",
          padding: "var(--space-3)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          minHeight: 0,
        }}
        aria-label="Quellen und Notizen"
      >
        <div style={{ display: "flex", gap: "var(--space-1)" }}>
          {(["sources", "notes"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              style={{
                flex: 1,
                borderColor: tab === t ? "var(--accent)" : "var(--rule)",
                color: tab === t ? "var(--accent)" : "inherit",
              }}
            >
              {t === "sources" ? "Quellen" : "Notizen"}
            </button>
          ))}
        </div>
        {tab === "sources" ? (
          <>
            <button
              className="primary"
              onClick={() => importFile.mutate()}
              disabled={importFile.isPending}
            >
              {importFile.isPending ? "Importiere…" : "+ Quelle hinzufügen"}
            </button>
            {importFile.isError && (
              <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>
                {importFile.error.message}
              </p>
            )}
            <SourceList sources={sources ?? []} />
          </>
        ) : (
          <NotesPanel notebookId={notebookId} />
        )}
      </aside>
      <ChatPanel notebookId={notebookId} sources={sources ?? []} />
    </div>
  );
}

function guessType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  };
  return map[ext ?? ""] ?? "application/octet-stream";
}

function SourceList({ sources }: { sources: Array<{ _id: string; fileName: string; status: string; errorMessage?: string | null }> }) {
  if (!sources.length) {
    return (
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Noch keine Quellen. Datei importieren, um zu starten.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)", overflowY: "auto" }}>
      {sources.map((s) => (
        <li
          key={s._id}
          style={{
            padding: "var(--space-2)",
            border: "1px solid var(--rule)",
            borderRadius: "var(--radius)",
            fontSize: "0.85rem",
          }}
        >
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <span
              aria-hidden
              style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background:
                  s.status === "completed" ? "var(--ok)"
                    : s.status === "error" ? "var(--accent)"
                    : "var(--warn)",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.fileName}
            </span>
          </div>
          {s.status !== "completed" && (
            <span className="mono" style={{ color: "var(--ink-40)" }}>{s.status}</span>
          )}
          {s.status === "error" && s.errorMessage && (
            <p style={{ color: "var(--accent)", fontSize: "0.75rem", margin: "var(--space-1) 0 0" }}>{s.errorMessage}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function ChatPanel({
  notebookId,
  sources,
}: {
  notebookId: string;
  sources: Array<{ _id: string; fileName: string }>;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { data: messages } = useQuery({
    queryKey: ["messages", notebookId],
    queryFn: () => desktopApi.listMessages(notebookId),
  });

  const send = useMutation({
    mutationFn: (message: string) => desktopApi.sendChat(notebookId, message),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["messages", notebookId] });
    },
    onError: (e) => setError(e.message),
  });

  return (
    <section style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }} aria-label="Conversation">
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {!messages?.length ? (
          <p className="muted" style={{ textAlign: "center", marginTop: "var(--space-6)" }}>
            Stelle eine Frage an deine Quellen.
          </p>
        ) : (
          messages.map((m) => (
            <article
              key={m._id}
              style={{
                maxWidth: "80%",
                alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                padding: "var(--space-3)",
                borderRadius: "var(--radius)",
                border: m.role === "user" ? "1px solid var(--rule)" : "none",
                borderLeft: m.role === "assistant" ? "3px solid var(--accent)" : undefined,
                background: m.role === "user" ? "var(--paper-muted)" : "var(--surface)",
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
              {m.citations && m.citations.length > 0 && <CitationList citations={m.citations} sources={sources} />}
            </article>
          ))
        )}
        {send.isPending && <p className="muted">Denkt nach…</p>}
        {error && <p style={{ color: "var(--accent)", margin: 0 }}>{error}</p>}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !send.isPending) {
            send.mutate(input.trim());
            setInput("");
          }
        }}
        style={{ display: "flex", gap: "var(--space-2)", padding: "var(--space-3) var(--space-4)", borderTop: "1px solid var(--rule)" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Frage an deine Quellen…"
          aria-label="Nachricht"
          disabled={send.isPending}
        />
        <button className="primary" type="submit" disabled={!input.trim() || send.isPending}>
          Senden
        </button>
      </form>
    </section>
  );
}

function CitationList({
  citations,
  sources,
}: {
  citations: Array<{ sourceId: string; chunkIndex: number; text: string; fileName?: string }>;
  sources: Array<{ _id: string; fileName: string }>;
}) {
  return (
    <div className="rule-top" style={{ marginTop: "var(--space-2)", paddingTop: "var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {citations.map((c, i) => {
        const name = c.fileName ?? sources.find((s) => s._id === c.sourceId)?.fileName ?? "Quelle";
        return (
          <details key={i} style={{ fontSize: "0.8rem" }}>
            <summary style={{ cursor: "pointer", color: "var(--accent)" }}>
              [{i + 1}] {name} · Abschnitt {c.chunkIndex + 1}
            </summary>
            <blockquote
              style={{
                margin: "var(--space-1) 0 0",
                padding: "0 0 0 var(--space-2)",
                borderLeft: "2px solid var(--accent-soft)",
                color: "var(--ink-60)",
              }}
            >
              {c.text}
            </blockquote>
          </details>
        );
      })}
    </div>
  );
}

function NotesPanel({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: notes } = useQuery({
    queryKey: ["notes", notebookId],
    queryFn: () => desktopApi.listNotes(notebookId),
  });

  const create = useMutation({
    mutationFn: () => desktopApi.createNote(notebookId, title.trim(), content),
    onSuccess: () => {
      setTitle("");
      setContent("");
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ["notes", notebookId] });
    },
  });

  return (
    <>
      <button onClick={() => setAdding(!adding)}>{adding ? "Abbrechen" : "+ Notiz"}</button>
      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
        >
          <input autoFocus placeholder="Titel" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Notiz-Titel" />
          <textarea
            placeholder="Notiz…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            aria-label="Notiz-Inhalt"
          />
          <button className="primary" type="submit" disabled={!title.trim() || create.isPending}>
            Speichern
          </button>
        </form>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {(notes ?? []).map((n) => (
          <li key={n._id} style={{ padding: "var(--space-2)", border: "1px solid var(--rule)", borderRadius: "var(--radius)", fontSize: "0.85rem" }}>
            <strong>{n.title}</strong>
            {n.content && (
              <p className="muted" style={{ margin: "var(--space-1) 0 0", whiteSpace: "pre-wrap" }}>{n.content}</p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
