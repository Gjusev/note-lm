import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, pickFile, type EmbeddingRecipeView } from "../lib/api";
import { ProviderSettings } from "./ProviderSettings";

interface ManagedModel {
  _id: string;
  capability: "chat" | "embeddings";
  fileName: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  origin: string | null;
}

/** Settings — AI on this machine (phase 5): import GGUFs via the native
 *  dialog, choose the active chat/embeddings model. No .env involved. */
export function Settings() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["models"],
    queryFn: desktopApi.listModels,
  });

  const catalog = useQuery({
    queryKey: ["catalog"],
    queryFn: desktopApi.listCatalogModels,
  });

  const download = useMutation({
    mutationFn: desktopApi.downloadCatalogModel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["models"] }),
    onError: (e) => setError(e.message),
  });

  const importModel = useMutation({
    mutationFn: async (capability: "chat" | "embeddings") => {
      const picked = await pickFile();
      if (!picked) throw new Error("Keine Datei gewählt (Dialog nur im Desktop-Fenster)");
      return desktopApi.importModel(picked.path, capability);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["models"] }),
    onError: (e) => setError(e.message),
  });

  const select = useMutation({
    mutationFn: (m: ManagedModel) => desktopApi.selectModel(m._id, m.capability),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["models"] }),
    onError: (e) => setError(e.message),
  });

  // Staged-activation progress (P3): the ACTIVE embed model's catalog recipe
  // tells us how many chunks still lack vectors. Poll while pendingCount > 0
  // ("Index wird aufgebaut"); at 0 the profile is complete. Imported GGUFs
  // without a catalog recipe keep the manual activate contract - no poll.
  const activeEmbedModel = (data?.models ?? []).find(
    (m: ManagedModel) => m.capability === "embeddings" && m._id === data?.activeEmbedModelId
  ) ?? null;
  const activeRecipe: EmbeddingRecipeView | null = activeEmbedModel
    ? (catalog.data?.entries ?? []).find((e) => e.sha256 === activeEmbedModel.sha256)?.embeddingRecipe ?? null
    : null;
  const profileStatus = useQuery({
    queryKey: ["profile-status", activeRecipe?.provider, activeRecipe?.model, activeRecipe?.revision],
    queryFn: () => desktopApi.profileStatus(activeRecipe!),
    enabled: activeRecipe != null,
    refetchInterval: (q) => ((q.state.data?.pendingCount ?? 0) > 0 ? 3000 : false),
  });
  const pendingChunks = profileStatus.data?.pendingCount ?? 0;

  return (
    <section className="page-shell" style={{ maxWidth: "760px", margin: "0 auto", padding: "var(--space-6)", width: "100%" }}>
      <h1 style={{ fontSize: "1.3rem", marginTop: 0 }}>Einstellungen · IA</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Modelle auf diesem Computer. Chat und Embeddings werden getrennt konfiguriert; ohne
        Konfiguration bleiben Notizbücher, Quellen und Textsuche voll funktionsfähig.
      </p>
      {/* Re-open the first-run wizard (Onboarding listens for the event) */}
      <p style={{ marginTop: 0 }}>
        <button onClick={() => window.dispatchEvent(new CustomEvent("notelm:onboarding"))}>
          Einführung erneut starten
        </button>
      </p>

      <ProviderSettings />

      <h2 style={{ fontSize: "1.05rem", marginBottom: "var(--space-2)" }}>Modellkatalog</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
        Vorgeprüfte Modelle. Herunterladen bezieht die Datei von Hugging Face und prüft die
        SHA-256-Prüfsumme, bevor sie freigegeben wird.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr>
              {["Modell", "Typ", "Größe", "Lizenz", "Aktion"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(catalog.data?.entries ?? []).map((entry) => {
              const managed = (data?.models ?? []).find((m: ManagedModel) => m.sha256 === entry.sha256);
              // whisper entries are settings-tracked, never models rows
              const verified = entry.url !== null && managed !== undefined;
              const activeId = entry.capability === "chat"
                ? data?.activeChatModelId
                : entry.capability === "embed" ? data?.activeEmbedModelId : undefined;
              const active = verified && managed != null && activeId === managed._id;
              const downloading = download.isPending && download.variables?.sha256 === entry.sha256;
              return (
                <tr key={entry.id}>
                  <td style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>
                    <div>{entry.label}</div>
                    {entry.notes && (
                      <div className="muted" style={{ fontSize: "0.8rem" }}>{entry.notes}</div>
                    )}
                    {downloading && (
                      <div className="chip" style={{ background: "var(--status-info)", color: "var(--status-info-fg)", marginTop: "var(--space-1)" }}>Wird geladen…</div>
                    )}
                    {verified && (
                      <div className="chip" style={{ background: "var(--status-success)", color: "var(--status-success-fg)", marginTop: "var(--space-1)" }}>Verifiziert</div>
                    )}
                  </td>
                  <td className="mono" style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>
                    {entry.capability === "chat" ? "Chat" : entry.capability === "embed" ? "Embeddings" : "Transkription"}
                  </td>
                  <td className="mono" style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>
                    {(entry.sizeBytes / 1048576).toFixed(0)} MB
                  </td>
                  <td style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>{entry.license}</td>
                  <td style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>
                    {verified ? (
                      active ? (
                        <span className="chip" style={{ background: "var(--status-success)", color: "var(--status-success-fg)" }}>aktiv</span>
                      ) : (
                        <button
                          onClick={() =>
                            select.mutate({
                              ...managed!,
                              capability: entry.capability === "embed" ? "embeddings" : "chat",
                            })
                          }
                          disabled={select.isPending}
                        >
                          Aktivieren
                        </button>
                      )
                    ) : entry.url ? (
                      <button onClick={() => download.mutate(entry)} disabled={download.isPending}>
                        Herunterladen
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {catalog.error && (
        <p style={{ color: "var(--accent)", margin: 0 }}>{catalog.error.message}</p>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", margin: "var(--space-4) 0" }}>
        <button className="primary" onClick={() => importModel.mutate("chat")} disabled={importModel.isPending}>
          {importModel.isPending ? "Importiere…" : "Chat-Modell importieren (GGUF)"}
        </button>
        <button onClick={() => importModel.mutate("embeddings")} disabled={importModel.isPending}>
          Embedding-Modell importieren
        </button>
      </div>
      {error && <p style={{ color: "var(--accent)", margin: 0 }}>{error}</p>}

      {(["chat", "embeddings"] as const).map((cap) => {
        const rows = (data?.models ?? []).filter((m: ManagedModel) => m.capability === cap);
        const activeId = cap === "chat" ? data?.activeChatModelId : data?.activeEmbedModelId;
        return (
          <div key={cap} style={{ marginTop: "var(--space-4)" }}>
            <p className="mono" style={{ margin: "0 0 var(--space-2)" }}>
              {cap === "chat" ? "Konversation" : "Embeddings"}
            </p>
            {!rows.length ? (
              <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                Noch kein Modell importiert.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                {rows.map((m: ManagedModel) => (
                  <li
                    key={m._id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      padding: "var(--space-2) var(--space-3)",
                      border: `1px solid ${activeId === m._id ? "var(--accent)" : "var(--rule)"}`,
                      fontSize: "0.9rem",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.fileName}
                    </span>
                    <span className="mono">{(m.sizeBytes / 1048576).toFixed(0)} MB</span>
                    {activeId === m._id ? (
                      <span className="chip" style={{ background: "var(--status-success)", color: "var(--status-success-fg)" }}>aktiv</span>
                    ) : (
                      <button onClick={() => select.mutate(m)} disabled={select.isPending}>
                        Aktivieren
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {/* Index build progress of the active embed profile (P3): the
                sweep builds the ACTIVE profile; while chunks are pending the
                semantic search reports "indexing". */}
            {cap === "embeddings" && pendingChunks > 0 && (
              <p className="meta" role="status" style={{ margin: "var(--space-2) 0 0", fontSize: "0.72rem", textTransform: "none", letterSpacing: "0.04em" }}>
                Index wird aufgebaut: {pendingChunks} Chunks
              </p>
            )}
          </div>
        );
      })}

      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "var(--space-6)" }}>
        Hinweis: beim Wechsel des Embedding-Modells wird der semantische Index zurückgesetzt und die
        Textsuche bleibt aktiv, bis die Quellen neu indexiert sind.
      </p>
    </section>
  );
}
