/**
 * ChatView (workspace redesign): the conversation is a CENTER view now. The
 * thread lives in the TanStack cache (queryKey ["messages", notebookId]) and
 * the input draft persists in the notebook UI state under drafts["chat"],
 * so switching views or panels never loses the thread (mandate 3).
 *
 * "Zur Seitenspalte zurück": phase 1 keeps the chat as a center view
 * (there is no side chat yet) - the honest deviation is recorded in the
 * report; switching away and back preserves everything.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, type Message, type Source } from "../lib/api";
import { ErrorLine } from "../lib/errors";
import { fmtTime, t } from "../i18n";
import type { NotebookUiState } from "../lib/uiState";

export function ChatView(props: {
  notebookId: string;
  sources: Array<{ _id: string; fileName: string }>;
  ui: NotebookUiState;
  update: (patch: Partial<NotebookUiState> | ((prev: NotebookUiState) => Partial<NotebookUiState>)) => void;
  openSource: (sourceId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown | null>(null);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  /** chat.send reports the retrieval state it actually used: vectorStatus
   *  "indexing" means the embedding index is still being built, so the
   *  answer came from text search only - surfaced, never silent. */
  const [indexingHint, setIndexingHint] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  const { data: messages } = useQuery({
    queryKey: ["messages", props.notebookId],
    queryFn: () => desktopApi.listMessages(props.notebookId),
  });

  const draft = props.ui.drafts["chat"] ?? "";
  const setDraft = (v: string) => props.update((prev) => ({ drafts: { ...prev.drafts, chat: v } }));

  const send = useMutation({
    mutationFn: (message: string) => desktopApi.sendChat(props.notebookId, message),
    onSuccess: (data) => {
      setError(null);
      setProviderLabel(data.provider?.label ?? null);
      setIndexingHint(data.vectorStatus === "indexing");
      queryClient.invalidateQueries({ queryKey: ["messages", props.notebookId] });
    },
    onError: (e) => setError(e),
  });

  const saveClaim = useMutation({
    mutationFn: (m: Message) => desktopApi.createClaimFromMessage(props.notebookId, m._id, m.content),
    onSuccess: (_data, m) => {
      setSavedIds((prev) => new Set(prev).add(m._id));
      queryClient.invalidateQueries({ queryKey: ["claims", props.notebookId] });
    },
  });

  // The provider label travels with the response it describes: it is known
  // for the most recent assistant message of this session only - older
  // rows honestly fall back to the role label.
  const lastAssistantId = [...(messages ?? [])].reverse().find((m) => m.role === "assistant")?._id ?? null;

  return (
    <section aria-label={t("chat.sectionAria")} style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {!messages?.length ? (
          <p className="meta" style={{ textAlign: "center", marginTop: "var(--space-6)", fontSize: "0.68rem", lineHeight: 1.6 }}>
            {t("chat.empty")}
          </p>
        ) : (
          messages.map((m) =>
            m.role === "assistant" ? (
              <article
                key={m._id}
                style={{
                  alignSelf: "flex-start", maxWidth: "80%",
                  borderLeft: "2px solid var(--ink)", paddingLeft: "var(--space-3)",
                  display: "flex", flexDirection: "column", gap: "var(--space-1)",
                }}
              >
                <span className="meta" style={{ fontSize: "0.62rem" }}>
                  {m._id === lastAssistantId && providerLabel ? providerLabel : t("chat.assistantRole")}
                  {" · "}
                  {fmtTime(m.createdAt)}
                </span>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
                {m.citations && m.citations.length > 0 && (
                  <CitationList citations={m.citations} sources={props.sources}
                    onOpenCitation={(sourceId) => props.openSource(sourceId)} />
                )}
                {m.citations != null && m.citations.length > 0 && (
                  savedIds.has(m._id) ? (
                    <span className="muted" style={{ fontSize: "0.8rem", display: "inline-block" }}>{t("chat.saved")}</span>
                  ) : (
                    <button style={{ fontSize: "0.8rem", display: "inline-block", alignSelf: "flex-start" }}
                      disabled={saveClaim.isPending} onClick={() => saveClaim.mutate(m)}>
                      {t("chat.saveClaim")}
                    </button>
                  )
                )}
              </article>
            ) : (
              <article key={m._id} style={{ alignSelf: "flex-end", maxWidth: "80%", textAlign: "right", whiteSpace: "pre-wrap" }}>
                {m.content}
              </article>
            )
          )
        )}
        {indexingHint && (
          <p className="meta" role="status" style={{ alignSelf: "flex-start", margin: 0, fontSize: "0.7rem", textTransform: "none", letterSpacing: "0.04em" }}>
            {t("chat.indexing")}
          </p>
        )}
        {send.isPending && <p className="muted">{t("chat.thinking")}</p>}
        {error != null && <ErrorLine e={error} />}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !send.isPending) {
            send.mutate(draft.trim());
            setDraft("");
          }
        }}
        style={{ display: "flex", gap: "var(--space-2)", padding: "var(--space-3) var(--space-4)", borderTop: "1px solid var(--rule)" }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={t("chat.placeholder")} aria-label={t("chat.messageAria")} disabled={send.isPending} />
        <button className="primary" type="submit" disabled={!draft.trim() || send.isPending}>{t("chat.send")}</button>
      </form>
    </section>
  );
}

/** Citation chips under an assistant answer; opening one jumps the reader
 *  into the source view (the reader itself is opened from the inspector,
 *  where the claim with its anchors is selected). */
function CitationList(props: {
  citations: NonNullable<Message["citations"]>;
  sources: Array<{ _id: string; fileName: string }>;
  onOpenCitation: (sourceId: string) => void;
}) {
  return (
    <div className="rule-top" style={{ marginTop: "var(--space-2)", paddingTop: "var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      {props.citations.map((c, i) => {
        const name = c.fileName ?? props.sources.find((s) => s._id === c.sourceId)?.fileName ?? t("common.sourceFallback");
        return (
          <details key={i} style={{ fontSize: "0.8rem" }}>
            <summary style={{ cursor: "pointer", color: "var(--accent)" }}>
              {t("chat.citation", { i: i + 1, name, n: c.chunkIndex + 1 })}
            </summary>
            <blockquote style={{ margin: "var(--space-1) 0 0", padding: "0 0 0 var(--space-2)", borderLeft: "2px solid var(--accent)", color: "var(--ink-60)" }}>
              {c.text}
            </blockquote>
            <button style={{ fontSize: "0.8rem", margin: "var(--space-1) 0 0", display: "inline-block" }} onClick={() => props.onOpenCitation(c.sourceId)}>
              {t("chat.openSource")}
            </button>
          </details>
        );
      })}
    </div>
  );
}
