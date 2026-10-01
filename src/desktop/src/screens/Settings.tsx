import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi, pickFile, type EmbeddingRecipeView } from "../lib/api";
import { ErrorLine } from "../lib/errors";
import { LangSelect, fmtMB, t } from "../i18n";
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
  const [error, setError] = useState<unknown | null>(null);

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
    onError: (e) => setError(e),
  });

  const importModel = useMutation({
    mutationFn: async (capability: "chat" | "embeddings") => {
      const picked = await pickFile();
      if (!picked) throw new Error(t("errors.noFileSettings"));
      return desktopApi.importModel(picked.path, capability);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["models"] }),
    onError: (e) => setError(e),
  });

  const select = useMutation({
    mutationFn: (m: ManagedModel) => desktopApi.selectModel(m._id, m.capability),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["models"] }),
    onError: (e) => setError(e),
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
      <h1 style={{ fontSize: "1.3rem", marginTop: 0 }}>{t("settings.title")}</h1>
      {/* Language: applies immediately and persists (notelm.lang). */}
      <div style={{ display: "flex", justifyContent: "flex-start", margin: "0 0 var(--space-3)" }}>
        <LangSelect style={{ fontSize: "0.8rem" }} />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("settings.intro")}
      </p>
      {/* Re-open the first-run wizard (Onboarding listens for the event) */}
      <p style={{ marginTop: 0 }}>
        <button onClick={() => window.dispatchEvent(new CustomEvent("notelm:onboarding"))}>
          {t("settings.restartOnboarding")}
        </button>
      </p>

      <ProviderSettings />

      <h2 style={{ fontSize: "1.05rem", marginBottom: "var(--space-2)" }}>{t("settings.catalogTitle")}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.85rem" }}>
        {t("settings.catalogIntro")}
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr>
              {[t("settings.colModel"), t("common.type"), t("settings.colSize"), t("settings.colLicense"), t("settings.colAction")].map((h) => (
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
                      <div className="chip" style={{ background: "var(--status-info)", color: "var(--status-info-fg)", marginTop: "var(--space-1)" }}>{t("settings.downloading")}</div>
                    )}
                    {verified && (
                      <div className="chip" style={{ background: "var(--status-success)", color: "var(--status-success-fg)", marginTop: "var(--space-1)" }}>{t("settings.verified")}</div>
                    )}
                  </td>
                  <td className="mono" style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>
                    {entry.capability === "chat" ? t("settings.typeChat") : entry.capability === "embed" ? t("settings.typeEmbed") : t("settings.typeTranscribe")}
                  </td>
                  <td className="mono" style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>
                    {fmtMB(entry.sizeBytes)}
                  </td>
                  <td style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>{entry.license}</td>
                  <td style={{ padding: "var(--space-2)", borderBottom: "1px solid var(--rule)" }}>
                    {verified ? (
                      active ? (
                        <span className="chip" style={{ background: "var(--status-success)", color: "var(--status-success-fg)" }}>{t("settings.active")}</span>
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
                          {t("settings.activate")}
                        </button>
                      )
                    ) : entry.url ? (
                      <button onClick={() => download.mutate(entry)} disabled={download.isPending}>
                        {t("settings.download")}
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
      {catalog.error != null && <ErrorLine e={catalog.error} />}

      <div style={{ display: "flex", gap: "var(--space-2)", margin: "var(--space-4) 0" }}>
        <button className="primary" onClick={() => importModel.mutate("chat")} disabled={importModel.isPending}>
          {importModel.isPending ? t("common.importing") : t("settings.importChat")}
        </button>
        <button onClick={() => importModel.mutate("embeddings")} disabled={importModel.isPending}>
          {t("settings.importEmbed")}
        </button>
      </div>
      {error != null && <ErrorLine e={error} />}

      {(["chat", "embeddings"] as const).map((cap) => {
        const rows = (data?.models ?? []).filter((m: ManagedModel) => m.capability === cap);
        const activeId = cap === "chat" ? data?.activeChatModelId : data?.activeEmbedModelId;
        return (
          <div key={cap} style={{ marginTop: "var(--space-4)" }}>
            <p className="mono" style={{ margin: "0 0 var(--space-2)" }}>
              {cap === "chat" ? t("settings.capChat") : t("settings.typeEmbed")}
            </p>
            {!rows.length ? (
              <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>
                {t("settings.noModels")}
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
                    <span className="mono">{fmtMB(m.sizeBytes)}</span>
                    {activeId === m._id ? (
                      <span className="chip" style={{ background: "var(--status-success)", color: "var(--status-success-fg)" }}>{t("settings.active")}</span>
                    ) : (
                      <button onClick={() => select.mutate(m)} disabled={select.isPending}>
                        {t("settings.activate")}
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
                {t("settings.indexBuilding", { n: pendingChunks })}
              </p>
            )}
          </div>
        );
      })}

      <p className="muted" style={{ fontSize: "0.8rem", marginTop: "var(--space-6)" }}>
        {t("settings.embedSwitchNote")}
      </p>
    </section>
  );
}
