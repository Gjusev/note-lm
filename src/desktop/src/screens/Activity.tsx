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

/** Activity center (desktop-workers-plan): every queue in one view with
 *  pause/resume/cancel per job. Status is observed state; the action
 *  persists the user intent — the scheduler confirms the effect. */
export function Activity() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["jobs"],
    queryFn: desktopApi.listJobs,
    // active work changes under us; poll while anything is running
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j: UnifiedJob) => !["completed", "failed", "cancelled"].includes(j.status))
        ? 2500
        : false,
  });

  const act = useMutation({
    mutationFn: (a: { kind: string; jobId: string; action: "pause" | "resume" | "cancel" }) =>
      desktopApi.jobAction(a.kind, a.jobId, a.action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const jobs: UnifiedJob[] = data?.jobs ?? [];
  const active = jobs.filter((j) => !["completed", "failed", "cancelled"].includes(j.status));

  return (
    <section style={{ maxWidth: "880px", margin: "0 auto", padding: "var(--space-6)", width: "100%" }}>
      <h1 style={{ fontSize: "1.3rem", marginTop: 0 }}>Aktivität</h1>
      <p className="muted" style={{ margin: 0 }}>
        {active.length === 0
          ? "Keine laufenden Aufgaben."
          : `${active.length} Aufgabe(n) in Arbeit — Fortschritt wird beim nächsten bestätigten Schritt aktualisiert.`}
      </p>

      {!jobs.length ? (
        <p className="muted" style={{ marginTop: "var(--space-4)" }}>
          Noch keine Aufgaben. Importiere Dateien oder erstelle Lernmaterialien.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {jobs.map((j) => {
            const done = ["completed", "failed", "cancelled"].includes(j.status);
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
                    background: j.status === "completed" ? "var(--ok)"
                      : j.status === "failed" || j.status === "cancelled" ? "var(--accent)"
                      : "var(--warn)",
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {j.title}
                </span>
                <span className="mono">{j.kind}</span>
                <span className="mono" style={{ color: "var(--ink-40)" }}>
                  {intentPending ? `wird ${j.intent === "pause" ? "pausiert" : "abgebrochen"}…` : j.status}
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
