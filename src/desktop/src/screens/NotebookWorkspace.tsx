import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  desktopApi,
  openExternalFile,
  pickFile,
  type ClaimAnchorView,
  type Message,
} from "../lib/api";

/** Workspace: sources left, chat center, notes right. Panels collapse on
 *  narrow windows (plan B4) — tabs at <900px via CSS. */
export function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"sources" | "claims" | "notes">("sources");

  const { data: sources } = useQuery({
    queryKey: ["sources", notebookId],
    queryFn: () => desktopApi.listSources(notebookId),
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.status === "pending" || s.status === "processing") ? 3000 : false,
  });

  // F4: the engine finishes imports in the background — without a ["jobs"]
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

  const importFile = useMutation({
    mutationFn: async () => {
      const picked = await pickFile();
      if (!picked) throw new Error("Keine Datei gewählt (Dialog nur im Desktop-Fenster verfügbar)");
      return desktopApi.importFile(picked.path, notebookId, picked.name, guessType(picked.name));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sources", notebookId] }),
  });

  const [urlInput, setUrlInput] = useState("");
  const importUrl = useMutation({
    mutationFn: (url: string) => desktopApi.importUrl(notebookId, url),
    onSuccess: () => {
      setUrlInput("");
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
    },
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
          {(["sources", "claims", "notes"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              style={{
                flex: 1,
                borderColor: tab === t ? "var(--accent)" : "var(--rule)",
                color: tab === t ? "var(--accent)" : "inherit",
                fontSize: "0.85rem",
              }}
            >
              {t === "sources" ? "Quellen" : t === "claims" ? "Afirmaciones" : "Notizen"}
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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (urlInput.trim() && !importUrl.isPending) importUrl.mutate(urlInput.trim());
              }}
              style={{ display: "flex", gap: "var(--space-1)" }}
            >
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://…"
                aria-label="Quelle per URL hinzufügen"
                disabled={importUrl.isPending}
              />
              <button type="submit" disabled={!urlInput.trim() || importUrl.isPending}>
                {importUrl.isPending ? "Importiere…" : "URL"}
              </button>
            </form>
            {importUrl.data?.deduped && (
              <p className="muted" style={{ fontSize: "0.8rem", margin: 0 }}>
                Import läuft bereits für diese Quelle.
              </p>
            )}
            {importUrl.isError && (
              <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>
                {importUrl.error.message}
              </p>
            )}
            <SourceList sources={sources ?? []} />
          </>
        ) : tab === "claims" ? (
          <ClaimsPanel notebookId={notebookId} />
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

function ChatPanel({ notebookId, sources }: { notebookId: string; sources: Array<{ _id: string; fileName: string }> }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // egress chip (S3): the label of the provider that answered the last send,
  // shown muted + mono next to the newest assistant answer
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  // messages already saved as claims: the button flips to "Gespeichert" and
  // stays disabled, so one message can never produce a duplicate claim
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  const { data: messages } = useQuery({
    queryKey: ["messages", notebookId],
    queryFn: () => desktopApi.listMessages(notebookId),
  });

  const send = useMutation({
    mutationFn: (message: string) => desktopApi.sendChat(notebookId, message),
    onSuccess: (data) => {
      setError(null);
      setProviderLabel(data.provider?.label ?? null);
      queryClient.invalidateQueries({ queryKey: ["messages", notebookId] });
    },
    onError: (e) => setError(e.message),
  });

  const saveClaim = useMutation({
    mutationFn: (m: Message) => desktopApi.createClaimFromMessage(notebookId, m._id, m.content),
    onSuccess: (_data, m) => {
      setSavedIds((prev) => new Set(prev).add(m._id));
      queryClient.invalidateQueries({ queryKey: ["claims", notebookId] });
    },
  });

  return (
    <section style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }} aria-label="Conversation">
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {!messages?.length ? (
          <p className="muted" style={{ textAlign: "center", marginTop: "var(--space-6)" }}>
            Stelle eine Frage an deine Quellen.
          </p>
        ) : (
          messages.map((m, i) => (
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
              {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                savedIds.has(m._id) ? (
                  <span className="muted" style={{ fontSize: "0.8rem", display: "inline-block", marginTop: "var(--space-1)" }}>
                    Gespeichert
                  </span>
                ) : (
                  <button
                    style={{ fontSize: "0.8rem", marginTop: "var(--space-1)", display: "inline-block" }}
                    disabled={saveClaim.isPending}
                    onClick={() => saveClaim.mutate(m)}
                  >
                    Aussage speichern
                  </button>
                )
              )}
              {m.role === "assistant" && providerLabel && i === messages.length - 1 && (
                <span
                  className="mono muted"
                  style={{
                    fontSize: "0.75rem",
                    display: "inline-block",
                    marginTop: "var(--space-1)",
                    padding: "0 var(--space-1)",
                    border: "1px solid var(--rule)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  {providerLabel}
                </span>
              )}
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

/** Claims tab (versioned-evidence S4): status/origin chips, anchor chips with
 *  Öffnen, pending review badges with Übernehmen/Ablehnen, manual creation. */
function ClaimsPanel({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);

  const { data: claims } = useQuery({
    queryKey: ["claims", notebookId],
    queryFn: () => desktopApi.listClaims(notebookId),
  });
  const { data: reviews } = useQuery({
    queryKey: ["reviews", notebookId],
    queryFn: () => desktopApi.listReviews(notebookId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["claims", notebookId] });
    queryClient.invalidateQueries({ queryKey: ["reviews", notebookId] });
  };

  const create = useMutation({
    mutationFn: () => desktopApi.createClaim(notebookId, text.trim()),
    onSuccess: () => {
      setText("");
      invalidate();
    },
  });

  const resolve = useMutation({
    mutationFn: (p: { proposalId: string; decision: "accepted" | "rejected" }) =>
      desktopApi.resolveReview(p.proposalId, p.decision),
    onSuccess: invalidate,
  });

  const proposalsByClaim = new Map((reviews ?? []).map((p) => [p.claimId, p]));

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim() && !create.isPending) create.mutate();
        }}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
      >
        <textarea
          placeholder="Neue Aussage…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          aria-label="Aussage-Text"
          disabled={create.isPending}
        />
        <button className="primary" type="submit" disabled={!text.trim() || create.isPending}>
          {create.isPending ? "Speichere…" : "Aussage speichern"}
        </button>
        {create.isError && (
          <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{create.error.message}</p>
        )}
      </form>
      {(claims ?? []).length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Noch keine Aussagen. Speichere eine Aussage aus dem Chat oder schreibe hier eine eigene.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {(claims ?? []).map((c) => (
            <li
              key={c._id}
              style={{
                padding: "var(--space-2)",
                border: "1px solid var(--rule)",
                borderRadius: "var(--radius)",
                fontSize: "0.85rem",
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-1)",
              }}
            >
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
                <span
                  style={{
                    fontSize: "0.75rem",
                    padding: "0 var(--space-1)",
                    border: "1px solid var(--rule)",
                    borderRadius: "var(--radius)",
                    color:
                      c.status === "reviewed" ? "var(--ok)"
                        : c.status === "withdrawn" ? "var(--warn)"
                        : "var(--ink-60)",
                  }}
                >
                  {c.status === "reviewed" ? "Überprüft" : c.status === "withdrawn" ? "Zurückgezogen" : "Aktiv"}
                </span>
                <span className="muted" style={{ fontSize: "0.75rem" }}>
                  {c.origin === "chat" ? "Chat" : "Manuell"}
                </span>
              </div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.text}</p>
              {c.anchors.map((a) => (
                <AnchorChip key={a.id} anchor={a} onOpenError={setOpenError} />
              ))}
              {(() => {
                const proposal = proposalsByClaim.get(c._id);
                if (!proposal) return null;
                return (
                  <div
                    style={{
                      border: "1px solid var(--warn)",
                      borderRadius: "var(--radius)",
                      padding: "var(--space-1) var(--space-2)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-1)",
                    }}
                  >
                    <span style={{ fontSize: "0.75rem" }}>
                      Überarbeitung vorgeschlagen — {proposal.detail ?? proposal.reason}
                    </span>
                    <div style={{ display: "flex", gap: "var(--space-1)" }}>
                      <button
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ proposalId: proposal.id, decision: "accepted" })}
                      >
                        Übernehmen
                      </button>
                      <button
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ proposalId: proposal.id, decision: "rejected" })}
                      >
                        Ablehnen
                      </button>
                    </div>
                  </div>
                );
              })()}
              {c.pendingReviews > 0 && !proposalsByClaim.has(c._id) && (
                <span className="muted" style={{ fontSize: "0.75rem" }}>
                  {c.pendingReviews} offene Überarbeitung(en)
                </span>
              )}
              {openError && (
                <p style={{ color: "var(--accent)", fontSize: "0.75rem", margin: 0 }}>{openError}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One evidence anchor: locator chip + quote snippet + Öffnen (evidence.open,
 *  then the Rust open_external_file guard when a path exists). An original
 *  without stored bytes says so, honestly. */
function AnchorChip({ anchor, onOpenError }: { anchor: ClaimAnchorView; onOpenError: (m: string | null) => void }) {
  const [state, setState] = useState<"idle" | "opening" | "unavailable">("idle");
  const locator =
    anchor.page != null
      ? `${anchor.fileName ?? "Quelle"} · v${anchor.version} · S.${anchor.page}`
      : `${anchor.fileName ?? "Quelle"} · v${anchor.version} · ohne Seite`;
  const open = async () => {
    setState("opening");
    onOpenError(null);
    try {
      const ev = await desktopApi.openEvidence(anchor.id);
      if (!ev.absolutePath) {
        setState("unavailable");
        return;
      }
      await openExternalFile(ev.absolutePath);
      setState("idle");
    } catch {
      setState("unavailable");
    }
  };
  return (
    <span style={{ display: "flex", gap: "var(--space-1)", alignItems: "center", flexWrap: "wrap", fontSize: "0.8rem" }}>
      <span
        className="muted"
        title={anchor.quote}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 210 }}
      >
        {locator} — {anchor.quote.length > 60 ? `${anchor.quote.slice(0, 59)}…` : anchor.quote}
      </span>
      <button style={{ fontSize: "0.75rem", padding: "0 var(--space-1)" }} disabled={state === "opening"} onClick={open}>
        Öffnen
      </button>
      {state === "unavailable" && (
        <span className="muted" style={{ fontSize: "0.75rem" }}>Originaldatei nicht verfügbar</span>
      )}
    </span>
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
