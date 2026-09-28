import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, pickFile } from "../lib/api";

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

  return (
    <section style={{ maxWidth: "760px", margin: "0 auto", padding: "var(--space-6)", width: "100%" }}>
      <h1 style={{ fontSize: "1.3rem", marginTop: 0 }}>Einstellungen · IA</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Modelle auf diesem Computer. Chat und Embeddings werden getrennt konfiguriert; ohne
        Konfiguration bleiben Notizbücher, Quellen und Textsuche voll funktionsfähig.
      </p>

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
                      borderRadius: "var(--radius)",
                      fontSize: "0.9rem",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.fileName}
                    </span>
                    <span className="mono">{(m.sizeBytes / 1048576).toFixed(0)} MB</span>
                    {activeId === m._id ? (
                      <span className="mono" style={{ color: "var(--ok)" }}>aktiv</span>
                    ) : (
                      <button onClick={() => select.mutate(m)} disabled={select.isPending}>
                        Aktivieren
                      </button>
                    )}
                  </li>
                ))}
              </ul>
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
