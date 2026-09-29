import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  desktopApi,
  pickFile,
  type ClaimAnchorView,
  type Message,
  type Source,
} from "../lib/api";
import { EvidencePanel, formatTimeRange } from "../components/EvidencePanel";

/** Workspace: sources left, chat center, notes right. Panels collapse on
 *  narrow windows (plan B4) — tabs at <900px via CSS. */
export function NotebookWorkspace({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"sources" | "claims" | "notes" | "calculations" | "materials">("sources");

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
          {(["sources", "claims", "notes", "calculations", "materials"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              style={{
                flex: 1,
                borderColor: tab === t ? "var(--accent)" : "var(--rule)",
                color: tab === t ? "var(--accent)" : "inherit",
                fontSize: "0.7rem",
              }}
            >
              {t === "sources"
                ? "Quellen"
                : t === "claims"
                  ? "Aussagen"
                  : t === "notes"
                    ? "Notizen"
                    : t === "calculations"
                      ? "Berechnungen"
                      : "Materialien"}
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
            <SourceList sources={sources ?? []} notebookId={notebookId} />
          </>
        ) : tab === "claims" ? (
          <ClaimsPanel notebookId={notebookId} />
        ) : tab === "calculations" ? (
          <CalcPanel notebookId={notebookId} sources={sources ?? []} />
        ) : tab === "materials" ? (
          <MaterialsPanel notebookId={notebookId} />
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

function SourceList({ sources, notebookId }: { sources: Source[]; notebookId: string }) {
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
        <SourceRow key={s._id} source={s} notebookId={notebookId} />
      ))}
    </ul>
  );
}

/** One source row: status dot + name, "Neue Version" re-import and a
 *  "Versionen" toggle with the immutable version list (strategy 5A). The
 *  inline result states the honest outcome: unchanged bytes, or the next
 *  version number that the enqueued processing job will land. */
function SourceRow({ source: s, notebookId }: { source: Source; notebookId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const reimport = useMutation({
    mutationFn: async () => {
      const picked = await pickFile();
      if (!picked) throw new Error("Keine Datei gewählt (Dialog nur im Desktop-Fenster verfügbar)");
      return desktopApi.reimportVersion(s._id, picked.path, picked.name);
    },
    onSuccess: async (r) => {
      queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
      queryClient.invalidateQueries({ queryKey: ["versions", s._id] });
      if (r.unchanged) {
        setResult("Unverändert");
        return;
      }
      // the job lands version latest+1 when processing finishes
      try {
        const vs = await desktopApi.listVersions(s._id);
        setResult(`Version ${(vs[vs.length - 1]?.version ?? 0) + 1} wird verarbeitet…`);
      } catch {
        setResult("Neue Version wird verarbeitet…");
      }
    },
  });

  const { data: versions } = useQuery({
    queryKey: ["versions", s._id],
    queryFn: () => desktopApi.listVersions(s._id),
    enabled: open,
    refetchInterval: open && s.status !== "completed" ? 3000 : false,
  });

  return (
    <li
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
      <div style={{ display: "flex", gap: "var(--space-1)", marginTop: "var(--space-1)" }}>
        <button style={{ fontSize: "0.75rem", padding: "0 var(--space-1)" }} disabled={reimport.isPending} onClick={() => reimport.mutate()}>
          {reimport.isPending ? "Importiere…" : "Neue Version"}
        </button>
        <button
          style={{ fontSize: "0.75rem", padding: "0 var(--space-1)" }}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          Versionen
        </button>
      </div>
      {result && (
        <p className="muted" style={{ margin: "var(--space-1) 0 0", fontSize: "0.75rem" }}>{result}</p>
      )}
      {open && (
        <div className="rule-top" style={{ marginTop: "var(--space-1)", paddingTop: "var(--space-1)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {(versions ?? []).length === 0 ? (
            <span className="muted" style={{ fontSize: "0.75rem" }}>Keine Versionen aufgezeichnet.</span>
          ) : (
            (versions ?? []).map((v) => (
              <span key={v.id} className="mono" style={{ fontSize: "0.7rem" }}>
                v{v.version} · {new Date(v.createdAt).toLocaleDateString("de-DE")} ·{" "}
                {v.pageCount != null ? `${v.pageCount} S.` : "CSV"}
              </span>
            ))
          )}
          {s.status !== "completed" && (
            <span className="muted" style={{ fontSize: "0.75rem" }}>Wird verarbeitet…</span>
          )}
        </div>
      )}
    </li>
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

/** Claims tab (versioned-evidence S4): status/origin chips, anchor chips
 *  opening the in-app EvidencePanel, EVERY proposal of a claim (pending with
 *  Übernehmen/Ablehnen; decided rows render decision + versions once the
 *  engine serves them - review.list is pending-only today), manual creation.
 *  No session decision memory: resolution state comes from query invalidation
 *  only. */
function ClaimsPanel({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  // the one open evidence panel - AnchorChip makes the anchor click open the
  // in-app reader; "Extern öffnen" lives inside the panel
  const [evidence, setEvidence] = useState<ClaimAnchorView | null>(null);

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
    mutationFn: (p: { claimId: string; proposalId: string; decision: "accepted" | "rejected" }) =>
      desktopApi.resolveReview(p.proposalId, p.decision),
    onSuccess: () => {
      // no session memory: the refetch brings back the persisted decision
      invalidate();
    },
  });

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
                <AnchorChip key={a.id} anchor={a} onOpen={setEvidence} />
              ))}
              {(() => {
                // EVERY proposal of this claim, oldest first; pending rows
                // carry the decision buttons, decided rows (once the engine
                // serves them - pending-only today) render the recorded
                // decision instead. No session fallback: query data only.
                const proposals = (reviews ?? [])
                  .filter((p) => p.claimId === c._id)
                  .sort((a, b) => a.createdAt - b.createdAt);
                const renderedPending = proposals.filter((p) => p.status === "pending").length;
                return (
                  <>
                    {proposals.map((proposal) =>
                      proposal.status === "pending" ? (
                        <div
                          key={proposal.id}
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
                            Überarbeitung vorgeschlagen · v{proposal.fromVersion} → v{proposal.toVersion} —{" "}
                            {proposal.detail ?? proposal.reason}
                          </span>
                          <div style={{ display: "flex", gap: "var(--space-1)" }}>
                            <button
                              disabled={resolve.isPending}
                              onClick={() => resolve.mutate({ claimId: c._id, proposalId: proposal.id, decision: "accepted" })}
                            >
                              Übernehmen
                            </button>
                            <button
                              disabled={resolve.isPending}
                              onClick={() => resolve.mutate({ claimId: c._id, proposalId: proposal.id, decision: "rejected" })}
                            >
                              Ablehnen
                            </button>
                          </div>
                        </div>
                      ) : (
                        // decided row: decision + versions + the finding, once
                        // review.list serves non-pending rows (pending-only today)
                        <div
                          key={proposal.id}
                          style={{
                            border: "1px solid var(--rule)",
                            borderRadius: "var(--radius)",
                            padding: "var(--space-1) var(--space-2)",
                            fontSize: "0.75rem",
                          }}
                        >
                          <span className="muted">
                            {proposal.status === "accepted" ? "Übernommen" : "Abgelehnt"}
                            {" · "}v{proposal.fromVersion} → v{proposal.toVersion} —{" "}
                            {proposal.detail ?? proposal.reason}
                          </span>
                        </div>
                      )
                    )}
                    {c.pendingReviews > 0 && renderedPending === 0 && (
                      <span className="muted" style={{ fontSize: "0.75rem" }}>
                        {c.pendingReviews} offene Überarbeitung(en)
                      </span>
                    )}
                  </>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
      {evidence && <EvidencePanel anchor={evidence} onClose={() => setEvidence(null)} />}
    </>
  );
}

/** One evidence anchor: locator + quote snippet as one chip; clicking opens
 *  the in-app EvidencePanel (delivery mandate P2) instead of an external
 *  viewer. "Extern öffnen" lives in the panel, gated on evidence.open's
 *  absolutePath - only an existing stored file enables it. */
function AnchorChip({ anchor, onOpen }: { anchor: ClaimAnchorView; onOpen: (a: ClaimAnchorView) => void }) {
  const locator = anchor.locator
    ? `${anchor.fileName ?? "Quelle"} · v${anchor.version} · ${formatTimeRange(anchor.locator)}`
    : anchor.page != null
      ? `${anchor.fileName ?? "Quelle"} · v${anchor.version} · S.${anchor.page}`
      : `${anchor.fileName ?? "Quelle"} · v${anchor.version} · ohne Seite`;
  return (
    <button
      title={anchor.quote}
      onClick={() => onOpen(anchor)}
      style={{ fontSize: "0.8rem", padding: "0 var(--space-1)", alignSelf: "flex-start" }}
    >
      <span
        style={{
          display: "inline-block",
          maxWidth: 250,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          verticalAlign: "bottom",
        }}
      >
        {locator} — {anchor.quote.length > 60 ? `${anchor.quote.slice(0, 59)}…` : anchor.quote}
      </span>
    </button>
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

/** Calculations tab (delivery mandate P2): deterministic sheet ops over an
 *  immutable source version. The big result plus the exact inputs (version,
 *  op, column, filter) underneath is the reproducibility record; a blocked op
 *  shows the engine's typed German error verbatim and records nothing. */
function CalcPanel({ notebookId, sources }: { notebookId: string; sources: Source[] }) {
  const queryClient = useQueryClient();
  // csv sources first - the default pick for the source select
  const ordered = [...sources].sort((a, b) =>
    a.fileType.includes("csv") === b.fileType.includes("csv") ? 0 : a.fileType.includes("csv") ? -1 : 1
  );
  // null = "auto": the first csv source until the user picks one
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
      // digits = 0-based column index, anything else = header name
      const parseCol = (raw: string): string | number =>
        /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw.trim();
      return desktopApi.runCalculation({
        notebookId,
        sourceId: activeSourceId,
        sourceVersionId: activeVersionId || undefined,
        op,
        column: parseCol(col),
        filter: fCol.trim() && fVal.trim()
          ? { column: parseCol(fCol), equals: fVal.trim() }
          : undefined,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calculations", notebookId] }),
  });

  const { data: history } = useQuery({
    queryKey: ["calculations", notebookId],
    queryFn: () => desktopApi.listCalculations(notebookId),
  });

  // map versionId -> version number across this notebook's sources, so the
  // history rows can say "v3" instead of a raw uuid
  const { data: versionLabels } = useQuery({
    queryKey: ["calc-version-labels", notebookId],
    queryFn: async () => {
      const lists = await Promise.all(sources.map((s) => desktopApi.listVersions(s._id)));
      return new Map(lists.flat().map((v) => [v.id, v.version]));
    },
    enabled: sources.length > 0,
  });

  const OP_LABELS: Record<string, string> = {
    sum: "Summe", avg: "Durchschnitt", min: "Minimum", max: "Maximum", count: "Anzahl",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", overflowY: "auto", minHeight: 0 }}>
      {ordered.length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Berechnungen brauchen eine Quelle. Importiere zuerst eine CSV-Datei.
        </p>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!run.isPending) run.mutate();
            }}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              Quelle
              <select
                value={activeSourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setVersionId(null);
                }}
                aria-label="Quelle für die Berechnung"
              >
                {ordered.map((s) => (
                  <option key={s._id} value={s._id}>{s.fileName}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              Version
              <select
                value={activeVersionId}
                onChange={(e) => setVersionId(e.target.value)}
                aria-label="Version für die Berechnung"
                disabled={(versions ?? []).length === 0}
              >
                {(versions ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version} · {v.pageCount != null ? `${v.pageCount} S.` : "CSV"} · {new Date(v.createdAt).toLocaleDateString("de-DE")}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              Operation
              <select value={op} onChange={(e) => setOp(e.target.value as typeof op)} aria-label="Berechnungsoperation">
                <option value="sum">Summe</option>
                <option value="avg">Durchschnitt</option>
                <option value="min">Minimum</option>
                <option value="max">Maximum</option>
                <option value="count">Anzahl</option>
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
              Spalte (Name oder Nummer)
              <input
                value={col}
                onChange={(e) => setCol(e.target.value)}
                placeholder="z. B. Menge oder 2"
                aria-label="Spalte"
              />
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
              <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{run.data.result}</div>
              <p className="muted" style={{ margin: "var(--space-1) 0 0", fontSize: "0.75rem" }}>
                {activeVersion ? `v${activeVersion.version}` : activeVersionId || "neueste Version"} · {OP_LABELS[run.data.operation] ?? run.data.operation} · Spalte{" "}
                {String(JSON.parse(run.data.argsJson).column)}
                {(() => {
                  const f = JSON.parse(run.data.argsJson).filter;
                  if (!f) return null;
                  return <> · Filter {String(f.column)} = "{f.equals}"</>;
                })()}
              </p>
            </div>
          )}
          {run.isError && (
            <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{run.error.message}</p>
          )}
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
                  {versionLabels?.get(c.sourceVersionId) != null ? ` · v${versionLabels.get(c.sourceVersionId)}` : ""}
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

/** German labels for the engine's material types (dispatch materials.request
 *  VALID_TYPES); order = the select's order. */
const MATERIAL_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "summary", label: "Zusammenfassung" },
  { id: "flashcards", label: "Lernkarten" },
  { id: "quiz", label: "Quiz" },
  { id: "studyGuide", label: "Lernleitfaden" },
  { id: "keyInsights", label: "Kernpunkte" },
  { id: "podcastSummary", label: "Podcast-Zusammenfassung" },
  { id: "slides", label: "Folien" },
];

/** Materials tab: pick a type, request generation (a typed busy error shows
 *  verbatim), list every material of the notebook with polling while any row
 *  is non-terminal. Completed content renders as a pre-wrap text block (no
 *  markdown dependency); error rows show the engine message. */
function MaterialsPanel({ notebookId }: { notebookId: string }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState("summary");

  const { data: materials } = useQuery({
    queryKey: ["materials", notebookId],
    queryFn: () => desktopApi.listMaterials(notebookId),
    refetchInterval: (q) =>
      q.state.data?.some((m) => m.status === "pending" || m.status === "generating") ? 3000 : false,
  });

  const request = useMutation({
    mutationFn: () => desktopApi.requestMaterial(notebookId, type),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["materials", notebookId] }),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", overflowY: "auto", minHeight: 0 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!request.isPending) request.mutate();
        }}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.8rem" }}>
          Materialtyp
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Materialtyp">
            {MATERIAL_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <button className="primary" type="submit" disabled={request.isPending}>
          {request.isPending ? "Wird erstellt…" : "Erstellen"}
        </button>
        {request.isError && (
          <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{request.error.message}</p>
        )}
      </form>
      {(materials ?? []).length === 0 ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Noch keine Materialien. Typ wählen und „Erstellen“ drücken.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {(materials ?? []).map((m) => (
            <div
              key={m._id}
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
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>
                  {MATERIAL_TYPES.find((t) => t.id === m.type)?.label ?? m.type}
                </strong>
                <span
                  className="mono"
                  style={{ fontSize: "0.7rem", color: m.status === "error" ? "var(--accent)" : "var(--ink-40)" }}
                >
                  {m.status === "completed"
                    ? new Date(m.updatedAt).toLocaleDateString("de-DE")
                    : m.status === "error"
                      ? "Fehler"
                      : "wird erstellt…"}
                </span>
                {m.needsReview === 1 && (
                  <span
                    className="mono"
                    style={{ fontSize: "0.7rem", color: "var(--warn)" }}
                    title="Eine versionierte Quelle, aus der dieses Material erstellt wurde, wurde geändert."
                  >
                    Quelle geändert - Inhalt prüfen
                  </span>
                )}
              </div>
              {m.status === "error" && m.errorMessage && (
                <p style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{m.errorMessage}</p>
              )}
              {m.status === "completed" && m.content && (
                <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>{m.content}</p>
              )}
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
