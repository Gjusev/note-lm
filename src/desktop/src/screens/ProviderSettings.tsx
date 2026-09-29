import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  desktopApi,
  saveConnectionSecret,
  PROVIDER_CAPABILITIES,
  type ConnectionView,
} from "../lib/api";

/** Empty form state for the add/edit connection dialog. */
interface ConnectionForm {
  id?: string;
  presetId: string;
  label: string;
  baseUrl: string;
  models: Record<string, string>;
  secret: string;
}

function emptyForm(presetId: string): ConnectionForm {
  return { presetId, label: "", baseUrl: "", models: {}, secret: "" };
}

const CARD = {
  border: "1px solid var(--rule)",
  padding: "var(--space-2) var(--space-3)",
} as const;

/** The KI-Anbieter section: connections list, add/edit dialog with per-
 *  capability tests, offline switch. Rendered by Settings above the model
 *  import block. */
export function ProviderSettings() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionForm | null>(null);
  /** capability -> probe outcome text (German, from the providers.test op) */
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["providers"], queryFn: desktopApi.listProviders });

  const save = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("Keine Verbindung geöffnet");
      const { id } = await desktopApi.saveProvider(
        {
          ...(form.id ? { id: form.id } : {}),
          presetId: form.presetId,
          label: form.label,
          ...(form.baseUrl ? { baseUrl: form.baseUrl } : {}),
        },
        form.models
      );
      // the key never persists in React state: cleared right after the save
      if (form.secret) await saveConnectionSecret(id, form.secret);
    },
    onSuccess: () => {
      setForm(null);
      setTestResults({});
      void queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
    onError: (e) => setError(e.message),
  });

  const offlineMutation = useMutation({
    mutationFn: (on: boolean) => desktopApi.setOffline(on),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["providers"] }),
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (connectionId: string) => desktopApi.deleteProvider(connectionId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["providers"] }),
    onError: (e) => setError(e.message),
  });

  async function test(capabilityId: string) {
    if (!form) return;
    setTesting(capabilityId);
    setTestResults((prev) => ({ ...prev, [capabilityId]: "" }));
    try {
      const result = await desktopApi.testProvider(
        capabilityId,
        {
          presetId: form.presetId,
          ...(form.baseUrl ? { baseUrl: form.baseUrl } : {}),
          ...(form.models[capabilityId] ? { model: form.models[capabilityId] } : {}),
        },
        form.secret || undefined
      );
      const dim = result.dimension ? ` — Dimension: ${result.dimension}` : "";
      setTestResults((prev) => ({ ...prev, [capabilityId]: `Verbindung OK${dim} (${result.latencyMs} ms)` }));
    } catch (e) {
      setTestResults((prev) => ({ ...prev, [capabilityId]: (e as Error).message }));
    } finally {
      setTesting(null);
    }
  }

  const presetFor = (presetId: string) => data?.presets.find((p) => p.id === presetId);
  const connCaps = (conn: ConnectionView) =>
    Object.entries(data?.capabilities ?? {})
      .filter(([, v]) => v.connectionId === conn.id)
      .map(([k]) => k);

  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <h2 style={{ fontSize: "1.05rem" }}>KI-Anbieter</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
        Verbindungen zu entfernten Anbietern (OpenAI-kompatibel). Zugangsdaten werden im
        Betriebssystem-Schlüsselbund gespeichert, nie in der Datenbank.
      </p>

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", margin: "var(--space-3) 0" }}>
        <button
          className="primary"
          onClick={() => {
            setForm(emptyForm("openai"));
            setTestResults({});
          }}
        >
          Verbindung hinzufügen
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={data?.offline ?? false}
            onChange={(e) => offlineMutation.mutate(e.target.checked)}
          />
          Offline-Modus (nur lokale Modelle)
        </label>
      </div>

      {error && <p style={{ color: "var(--accent)", margin: "0 0 var(--space-2)" }}>{error}</p>}

      {!data?.connections.length ? (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          Noch keine Verbindung eingerichtet.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          {data.connections.map((conn) => (
            <li key={conn.id} style={CARD}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <strong style={{ flexShrink: 0 }}>{conn.label}</strong>
                <span className="muted" style={{ flex: 1, fontSize: "0.85rem" }}>
                  {presetFor(conn.presetId)?.label ?? conn.presetId}
                  {conn.baseUrl ? ` — ${conn.baseUrl}` : ""}
                </span>
                <span className="mono" style={{ fontSize: "0.8rem" }}>
                  {connCaps(conn).join(", ") || "—"}
                </span>
                <button onClick={() => remove.mutate(conn.id)}>Entfernen</button>
                <button
                  onClick={() => {
                    setForm({
                      id: conn.id,
                      presetId: conn.presetId,
                      label: conn.label,
                      baseUrl: conn.baseUrl ?? "",
                      models: Object.fromEntries(
                        Object.entries(data.capabilities)
                          .filter(([, v]) => v.connectionId === conn.id)
                          .map(([k, v]) => [k, v.model])
                      ),
                      secret: "",
                    });
                    setTestResults({});
                  }}
                >
                  Bearbeiten
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <div style={{ ...CARD, marginTop: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1 }}>
              <span>Typ</span>
              <select
                value={form.presetId}
                onChange={(e) => setForm({ ...emptyForm(e.target.value), id: form.id, label: form.label })}
              >
                {(data?.presets ?? [])
                  .filter((p) => !p.experimental)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", flex: 1 }}>
              <span>Name</span>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="z. B. Mein OpenRouter" />
            </label>
          </div>

          {form.presetId === "custom" && (
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <span>Serveradresse</span>
              <input
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="http://localhost:1234/v1"
              />
            </label>
          )}

          {PROVIDER_CAPABILITIES.filter((c) => presetFor(form.presetId)?.capabilities.includes(c.id)).map((c) => (
            <div key={c.id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <span style={{ width: "110px", flexShrink: 0 }}>{c.label}</span>
              <input
                value={form.models[c.id] ?? ""}
                onChange={(e) => setForm({ ...form, models: { ...form.models, [c.id]: e.target.value } })}
                placeholder="Modell"
                style={{ flex: 1 }}
              />
              <button onClick={() => test(c.id)} disabled={testing === c.id}>
                {testing === c.id ? "Teste…" : "Verbindung testen"}
              </button>
              {testResults[c.id] !== undefined && (
                <span style={{ fontSize: "0.85rem", color: "var(--ink-60)" }}>{testResults[c.id]}</span>
              )}
            </div>
          ))}

          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span>Zugangsdaten (API-Schlüssel)</span>
            <input
              type="password"
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              placeholder="Wird im Schlüsselbund gespeichert, nie in der Datenbank"
              autoComplete="off"
            />
          </label>

          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button className="primary" onClick={() => save.mutate()} disabled={save.isPending || !form.label}>
              {save.isPending ? "Speichere…" : "Verbindung speichern"}
            </button>
            <button onClick={() => { setForm(null); setTestResults({}); }}>Abbrechen</button>
          </div>
          {save.isError && <p style={{ color: "var(--accent)", margin: 0 }}>{save.error.message}</p>}
        </div>
      )}
    </section>
  );
}
