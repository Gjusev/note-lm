import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi } from "../lib/api";

interface UnifiedJob {
  kind: "processing" | "import" | "material";
  id: string;
  notebookId: string;
  title: string;
  status: string;
  intent: "run" | "pause" | "cancel";
  updatedAt: number;
}

interface JobEvent {
  seq: number;
  jobKind: string;
  jobId: string;
  type: string;
  payload: string | null;
}

// Event-stream refresh (desktop-workers-plan): the screen keeps a jobs.list
// snapshot and advances a durable-event cursor instead of blind list polling.
// While work is active it streams events every 1.5s; progress events only
// advance the cursor (the writer coalesces them to ~1/s per job), while any
// structural event (running/paused/cancelled/failed/finished/
// download_restarted/intent.*) or a ~10s reconcile refetches the snapshot.
// A transport error — or a return to a tab that was hidden — falls back to a
// full resync: drop the cursor, refetch jobs.list, rebuild from scratch.
const EVENT_POLL_MS = 1500;
const LIST_RECONCILE_MS = 10_000;
const EVENT_PAGE_LIMIT = 200; // must match the engine's eventsSince page size

/** Terminal events mapped onto unified statuses for the local overlay. */
const EVENT_STATUS: Record<string, string> = {
  finished: "completed",
  failed: "failed",
  cancelled: "cancelled",
};
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

/** Activity center (desktop-workers-plan): every queue in one view with
 *  pause/resume/cancel per job. Status is observed state; the action
 *  persists the user intent — the scheduler confirms the effect. */
export function Activity() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["jobs"],
    queryFn: desktopApi.listJobs,
  });

  const act = useMutation({
    mutationFn: (a: { kind: string; jobId: string; action: "pause" | "resume" | "cancel" }) =>
      desktopApi.jobAction(a.kind, a.jobId, a.action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  // Way back from "Pausieren und beenden": the global pause persists across
  // engine restarts, so the activity screen must be able to lift it again.
  const resumeScheduler = useMutation({
    mutationFn: desktopApi.schedulerResume,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  // Status overlay from terminal events since the last snapshot refetch; it
  // only smooths the gap until the authoritative list lands.
  const [patches, setPatches] = useState(new Map<string, string>());
  const cursorRef = useRef(0);
  const snapshotAtRef = useRef(0);
  const hiddenRef = useRef(false);

  useEffect(() => {
    if (data) snapshotAtRef.current = Date.now();
  }, [data]);

  // Full reconnect: reset the cursor from scratch and rebuild the snapshot.
  const resync = useCallback(() => {
    cursorRef.current = 0;
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }, [queryClient]);

  const jobs: UnifiedJob[] = data?.jobs ?? [];
  const statusOf = (j: UnifiedJob) => patches.get(`${j.kind}:${j.id}`) ?? j.status;
  const active = jobs.filter((j) => !TERMINAL_STATUSES.includes(statusOf(j)));

  useEffect(() => {
    if (active.length === 0) return;
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        hiddenRef.current = true; // reconnect with a full resync once visible again
        return;
      }
      if (hiddenRef.current) {
        hiddenRef.current = false;
        resync();
        return;
      }
      try {
        let structural = false;
        let cursor = cursorRef.current;
        // page to the log head; the page limit caps each read, not the stream
        for (let page = 0; page < 20; page++) {
          const batch = await desktopApi.eventsSince(cursor);
          for (const e of batch.events as JobEvent[]) {
            if (e.type !== "progress") structural = true;
            const status = EVENT_STATUS[e.type];
            if (status) {
              const key = `${e.jobKind}:${e.jobId}`;
              setPatches((prev) => new Map(prev).set(key, status));
            }
          }
          cursor = batch.cursor;
          if (batch.events.length < EVENT_PAGE_LIMIT) break;
        }
        cursorRef.current = cursor;
        if (structural || Date.now() - snapshotAtRef.current >= LIST_RECONCILE_MS) {
          await queryClient.invalidateQueries({ queryKey: ["jobs"] });
          setPatches(new Map()); // the fresh snapshot supersedes the overlay
          snapshotAtRef.current = Date.now();
        }
      } catch {
        resync(); // gap or transport error: drop the cursor and rebuild
      }
    };

    const id = setInterval(tick, EVENT_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [active.length, resync, queryClient]);

  return (
    <section style={{ maxWidth: "880px", margin: "0 auto", padding: "var(--space-6)", width: "100%" }}>
      <h1 style={{ fontSize: "1.3rem", marginTop: 0 }}>Aktivität</h1>
      <p className="muted" style={{ margin: 0 }}>
        {active.length === 0
          ? "Keine laufenden Aufgaben."
          : `${active.length} Aufgabe(n) in Arbeit — Fortschritt wird beim nächsten bestätigten Schritt aktualisiert.`}
      </p>

      {data?.schedulerPaused && (
        <p
          style={{
            marginTop: "var(--space-3)",
            padding: "var(--space-2) var(--space-3)",
            border: "1px solid var(--warn)",
            borderRadius: "var(--radius)",
            fontSize: "0.9rem",
          }}
        >
          Planer pausiert — keine Aufgabe wird gestartet.{" "}
          <button onClick={() => resumeScheduler.mutate()} disabled={resumeScheduler.isPending}>
            Planer fortsetzen
          </button>
        </p>
      )}

      {!jobs.length ? (
        <p className="muted" style={{ marginTop: "var(--space-4)" }}>
          Noch keine Aufgaben. Importiere Dateien oder erstelle Lernmaterialien.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {jobs.map((j) => {
            const done = TERMINAL_STATUSES.includes(statusOf(j));
            const intentPending =
              (j.intent === "pause" || j.intent === "cancel") && !done;
            return (
              <li
                key={`${j.kind}:${j.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "var(--space-2) var(--space-3)",
                  border: "1px solid var(--rule)",
                  borderRadius: "var(--radius)",
                  fontSize: "0.9rem",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: statusOf(j) === "completed" ? "var(--ok)"
                      : statusOf(j) === "failed" || statusOf(j) === "cancelled" ? "var(--accent)"
                      : "var(--warn)",
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {j.title}
                </span>
                <span className="mono">{j.kind}</span>
                <span className="mono" style={{ color: "var(--ink-40)" }}>
                  {intentPending
                    ? statusOf(j) === "queued" || statusOf(j) === "pending"
                      // never started: the participle would be a lie — the job
                      // cannot transition, so show the static state instead
                      ? (j.intent === "pause" ? "pausiert" : "abgebrochen")
                      : `wird ${j.intent === "pause" ? "pausiert" : "abgebrochen"}…`
                    : statusOf(j)}
                </span>
                {!done && (
                  <>
                    <button
                      onClick={() => act.mutate({ kind: j.kind, jobId: j.id, action: j.intent === "pause" ? "resume" : "pause" })}
                      disabled={act.isPending}
                      aria-label={j.intent === "pause" ? "Fortsetzen" : "Pausieren"}
                    >
                      {j.intent === "pause" ? "▸" : "❚❚"}
                    </button>
                    <button
                      onClick={() => act.mutate({ kind: j.kind, jobId: j.id, action: "cancel" })}
                      disabled={act.isPending}
                      aria-label="Abbrechen"
                    >
                      ✕
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
