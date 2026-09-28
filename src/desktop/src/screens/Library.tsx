import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopApi } from "../lib/api";

/** Onboarding: the first notebook can be created before any AI is
 *  configured (plan phase 4 acceptance). */
export function Library() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: notebooks, isLoading } = useQuery({
    queryKey: ["notebooks"],
    queryFn: desktopApi.listNotebooks,
  });

  const create = useMutation({
    mutationFn: (t: string) => desktopApi.createNotebook(t),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      setAdding(false);
      setTitle("");
      window.location.hash = `#/nb/${data.id}`;
    },
  });

  return (
    <section style={{ maxWidth: "880px", margin: "0 auto", padding: "var(--space-6)", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-3)" }}>
        <h1 style={{ fontSize: "1.4rem", margin: 0 }}>Bibliothek</h1>
        <button className="primary" onClick={() => setAdding(!adding)}>
          {adding ? "Abbrechen" : "+ Notizbuch"}
        </button>
      </div>

      {adding && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate(title.trim());
          }}
          style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}
        >
          <input
            autoFocus
            placeholder="Titel, z.B. Seminararbeit Photovoltaik"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Notizbuch-Titel"
          />
          <button className="primary" type="submit" disabled={!title.trim() || create.isPending}>
            Erstellen
          </button>
        </form>
      )}

      {isLoading ? (
        <p className="muted" style={{ marginTop: "var(--space-6)" }}>Laden…</p>
      ) : !notebooks?.length ? (
        <div
          style={{
            marginTop: "var(--space-6)",
            padding: "var(--space-6)",
            textAlign: "center",
            border: "1px dashed var(--rule)",
            borderRadius: "var(--radius)",
          }}
        >
          <p className="mono" style={{ color: "var(--accent)" }}>[ LEER ]</p>
          <p className="muted">
            Erstelle dein erstes Notizbuch. KI kannst du später in den Einstellungen konfigurieren —
            Notizbücher, Quellen und Textsuche funktionieren ohne.
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--space-4)", display: "grid", gap: "var(--space-2)" }}>
          {notebooks.map((nb) => (
            <li key={nb._id}>
              <a
                href={`#/nb/${nb._id}`}
                style={{
                  display: "block",
                  padding: "var(--space-3) var(--space-4)",
                  border: "1px solid var(--rule)",
                  borderRadius: "var(--radius)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <strong>{nb.title}</strong>
                <span className="muted" style={{ display: "block", fontSize: "0.8rem" }}>
                  {new Date(nb.updatedAt).toLocaleDateString("de-DE")}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
