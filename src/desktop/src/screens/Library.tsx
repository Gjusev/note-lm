import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSampleNotebook, desktopApi } from "../lib/api";
import { fmtDate, t } from "../i18n";

/** Onboarding: the first notebook can be created before any AI is
 *  configured (plan phase 4 acceptance). */
export function Library() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  // Onboarding sample (strategy §9): one click builds the demo notebook
  // (v1 import + claim) on the Rust side; disabled while it runs because
  // the command polls the engine until the sample source is processed.
  const [sampling, setSampling] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const loadSample = async () => {
    setSampling(true);
    setSampleError(null);
    try {
      const data = await createSampleNotebook();
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      window.location.hash = `#/nb/${data.notebookId}`;
    } catch (err) {
      setSampleError(err instanceof Error ? err.message : String(err));
    } finally {
      setSampling(false);
    }
  };

  const { data: notebooks, isLoading } = useQuery({
    queryKey: ["notebooks"],
    queryFn: desktopApi.listNotebooks,
  });

  const create = useMutation({
    mutationFn: (t2: string) => desktopApi.createNotebook(t2),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      setAdding(false);
      setTitle("");
      window.location.hash = `#/nb/${data.id}`;
    },
  });

  return (
    <section className="page-shell" style={{ maxWidth: "880px", margin: "0 auto", padding: "var(--space-6)", width: "100%" }}>
      <div className="library-heading" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-3)" }}>
        <h1 style={{ fontSize: "1.4rem", margin: 0 }}>{t("library.title")}</h1>
        <div className="library-actions" style={{ display: "flex", gap: "var(--space-2)" }}>
          <button onClick={loadSample} disabled={sampling}>
            {sampling ? t("library.sampling") : t("library.loadSample")}
          </button>
          <button className="primary" onClick={() => setAdding(!adding)}>
            {adding ? t("common.cancel") : t("library.newNotebook")}
          </button>
        </div>
      </div>
      {sampleError && (
        <p role="alert" className="muted" style={{ margin: "var(--space-3) 0 0" }}>
          {sampleError}
        </p>
      )}

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate(title.trim());
          }}
          className="create-notebook-form"
          style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}
        >
          <input
            autoFocus
            placeholder={t("library.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label={t("library.titleAria")}
          />
          <button className="primary" type="submit" disabled={!title.trim() || create.isPending}>
            {t("library.create")}
          </button>
        </form>
      )}

      {isLoading ? (
        <p className="muted" style={{ marginTop: "var(--space-6)" }}>{t("common.loading")}</p>
      ) : !notebooks?.length ? (
        <div
          className="empty-state"
          style={{
            marginTop: "var(--space-6)",
            padding: "var(--space-6)",
            textAlign: "center",
            border: "1px dashed var(--rule)",
          }}
        >
          <p className="mono" style={{ color: "var(--accent)" }}>{t("library.emptyMark")}</p>
          <p className="muted">
            {t("library.emptyHint")}
          </p>
        </div>
      ) : (
        <ul className="notebook-list" style={{ listStyle: "none", padding: 0, marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
          {notebooks.map((nb) => (
            <li key={nb._id}>
              <a
                href={`#/nb/${nb._id}`}
                style={{
                  display: "block",
                  padding: "var(--space-3) var(--space-4)",
                  border: "1px solid var(--rule)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <strong>{nb.title}</strong>
                <span className="meta" style={{ display: "block", fontSize: "0.7rem" }}>
                  {fmtDate(nb.updatedAt)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
