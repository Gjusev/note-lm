/**
 * EvidenceInspector (workspace redesign): the right column - evidence
 * details, related refs, properties (section 5). Contents:
 * - the captured reader selection with the two D1 actions ("Als Beleg
 *   speichern" -> claims.create with anchors, "In Notiz einfügen" -> quote
 *   block + claim marker via notes.create/notes.update),
 * - the selected claim: status chips, anchor chips (each opens the stored
 *   original in the CENTER reader - no second viewer), review proposals
 *   with Übernehmen/Ablehnen.
 *
 * The two save actions are owned by the composition root and receive the
 * selection's FROZEN identity ({sourceId, versionId} captured at selection
 * time) - this component never re-resolves the version.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, type ClaimAnchorView, type ClaimView, type Source } from "../lib/api";
import { formatTimeRange } from "../components/EvidencePanel";
import type { NotebookUiState } from "../lib/uiState";
import type { ReaderSelection } from "./SourceReader";

/** What the reader currently has open (parent-owned, session state): the
 *  identity comes from the sources.open call, never from an anchor. */
export interface ReaderContext {
  sourceId: string;
  fileName: string;
  /** Immutable version row id of the opened version. */
  versionId: string | null;
  /** Display number of the opened version. */
  version: number | null;
  selection: ReaderSelection | null;
}

export function EvidenceInspector(props: {
  notebookId: string;
  sources: Source[];
  ui: NotebookUiState;
  update: (patch: Partial<NotebookUiState> | ((prev: NotebookUiState) => Partial<NotebookUiState>)) => void;
  reader: ReaderContext | null;
  openAnchor: (a: ClaimAnchorView) => void;
  /** Save paths owned by the composition root (shared with the reader's
   *  keyboard chooser); both take the frozen selection as-is. */
  onSaveClaim: (sel: ReaderSelection) => void;
  onInsertNote: (sel: ReaderSelection) => void;
  actionError: string | null;
  actionPending: boolean;
}) {
  const queryClient = useQueryClient();
  const claims = useQuery({ queryKey: ["claims", props.notebookId], queryFn: () => desktopApi.listClaims(props.notebookId) });
  const reviews = useQuery({ queryKey: ["reviews", props.notebookId], queryFn: () => desktopApi.listReviews(props.notebookId) });
  const notes = useQuery({ queryKey: ["notes", props.notebookId], queryFn: () => desktopApi.listNotes(props.notebookId) });
  const selectedClaim = (claims.data ?? []).find((c) => c._id === props.ui.selectedClaimId) ?? null;
  const proposals = useMemo(
    () => (reviews.data ?? []).filter((p) => p.claimId === props.ui.selectedClaimId).sort((a, b) => a.createdAt - b.createdAt),
    [reviews.data, props.ui.selectedClaimId]
  );

  const resolve = useMutation({
    mutationFn: (p: { proposalId: string; decision: "accepted" | "rejected" }) =>
      desktopApi.resolveReview(p.proposalId, p.decision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claims", props.notebookId] });
      queryClient.invalidateQueries({ queryKey: ["reviews", props.notebookId] });
    },
  });

  const sel = props.reader?.selection ?? null;
  const notesList = notes.data ?? [];
  const targetNoteId = props.ui.selectedNoteId ?? notesList[0]?._id ?? null;

  return (
    <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)", minHeight: 0, flex: 1, overflowY: "auto" }}>
      <h2 id="inspector-heading" style={{ margin: 0, fontSize: "1rem" }}>Beleg &amp; Details</h2>

      {sel && (
        <section aria-label="Auswahl im Dokument" style={{ border: "1px solid var(--accent)", borderRadius: "var(--radius)", padding: "var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span className="mono" style={{ fontSize: "0.7rem" }}>
            Auswahl · {props.reader?.fileName} · {sel.version != null ? `v${sel.version}` : "Version offen"} · S. {sel.page}
          </span>
          <blockquote style={{ margin: 0, padding: "0 0 0 var(--space-2)", borderLeft: "3px solid var(--accent-soft)", fontSize: "0.9rem", whiteSpace: "pre-wrap" }}>
            {sel.quote}
          </blockquote>
          <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
            Der Beleg bindet an die Version der Auswahl{sel.version != null ? ` (v${sel.version})` : ""} - auch wenn zwischenzeitlich eine neuere Version importiert wird.
          </p>
          <div style={{ display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
            <button className="primary" disabled={props.actionPending} onClick={() => props.onSaveClaim(sel)}>
              {props.actionPending ? "Speichere…" : "Als Beleg speichern"}
            </button>
            <button disabled={props.actionPending} onClick={() => props.onInsertNote(sel)}>
              {props.actionPending ? "Einfügen…" : targetNoteId ? "In Notiz einfügen" : "Als neue Notiz einfügen"}
            </button>
          </div>
          {props.actionError && <p role="alert" style={{ color: "var(--accent)", fontSize: "0.8rem", margin: 0 }}>{props.actionError}</p>}
        </section>
      )}

      {selectedClaim ? (
        <section aria-label="Ausgewählte Aussage" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <ClaimStatusChips claim={selectedClaim} />
          <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.9rem" }}>{selectedClaim.text}</p>
          {selectedClaim.anchors.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <span className="mono" style={{ fontSize: "0.7rem" }}>Belege</span>
              {selectedClaim.anchors.map((a) => <AnchorChip key={a.id} anchor={a} onOpen={props.openAnchor} />)}
            </div>
          )}
          {proposals.map((p) =>
            p.status === "pending" ? (
              <div key={p.id} style={{ border: "1px solid var(--warn)", borderRadius: "var(--radius)", padding: "var(--space-1) var(--space-2)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <span style={{ fontSize: "0.75rem" }}>
                  Überarbeitung vorgeschlagen · v{p.fromVersion} → v{p.toVersion} — {p.detail ?? p.reason}
                </span>
                <div style={{ display: "flex", gap: "var(--space-1)" }}>
                  <button disabled={resolve.isPending} onClick={() => resolve.mutate({ proposalId: p.id, decision: "accepted" })}>Übernehmen</button>
                  <button disabled={resolve.isPending} onClick={() => resolve.mutate({ proposalId: p.id, decision: "rejected" })}>Ablehnen</button>
                </div>
              </div>
            ) : (
              <div key={p.id} style={{ border: "1px solid var(--rule)", borderRadius: "var(--radius)", padding: "var(--space-1) var(--space-2)", fontSize: "0.75rem" }}>
                <span className="muted">
                  {p.status === "accepted" ? "Übernommen" : "Abgelehnt"} · v{p.fromVersion} → v{p.toVersion} — {p.detail ?? p.reason}
                </span>
              </div>
            )
          )}
          {selectedClaim.pendingReviews > 0 && proposals.filter((p) => p.status === "pending").length === 0 && (
            <span className="muted" style={{ fontSize: "0.75rem" }}>{selectedClaim.pendingReviews} offene Überarbeitung(en)</span>
          )}
        </section>
      ) : (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Wähle links eine Aussage, um Belege und Überarbeitungsvorschläge zu sehen.
        </p>
      )}

    </div>
  );
}

/** One anchor chip: locator + quote snippet; clicking opens the stored
 *  original in the CENTER reader at the anchor's version and page (the
 *  walkthrough's "Verweis folgen"), never a second viewer. */
function AnchorChip({ anchor, onOpen }: { anchor: ClaimAnchorView; onOpen: (a: ClaimAnchorView) => void }) {
  const locator = anchor.locator
    ? `${anchor.fileName ?? "Quelle"} · v${anchor.version} · ${formatTimeRange(anchor.locator)}`
    : anchor.page != null
      ? `${anchor.fileName ?? "Quelle"} · v${anchor.version} · S. ${anchor.page}`
      : `${anchor.fileName ?? "Quelle"} · v${anchor.version} · ohne Ort`;
  return (
    <button title={anchor.quote} onClick={() => onOpen(anchor)}
      style={{ fontSize: "0.8rem", padding: "0 var(--space-1)", alignSelf: "flex-start", textAlign: "left" }}>
      <span style={{ display: "inline-block", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
        {locator} — {anchor.quote.length > 60 ? `${anchor.quote.slice(0, 59)}…` : anchor.quote}
      </span>
    </button>
  );
}

function ClaimStatusChips({ claim }: { claim: ClaimView }) {
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
      <span className="mono" style={{ fontSize: "0.7rem", border: "1px solid var(--rule)", borderRadius: "var(--radius)", padding: "0 var(--space-1)",
        color: claim.status === "reviewed" ? "var(--ok)" : claim.status === "withdrawn" ? "var(--warn)" : "var(--ink-60)" }}>
        {claim.status === "reviewed" ? "Überprüft" : claim.status === "withdrawn" ? "Zurückgezogen" : "Aktiv"}
      </span>
      <span className="muted" style={{ fontSize: "0.75rem" }}>{claim.origin === "chat" ? "Chat" : "Manuell"}</span>
    </div>
  );
}
