import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  desktopApi,
  saveConnectionSecret,
  PROVIDER_CAPABILITIES,
  type ConnectionView,
} from "../lib/api";
import { t } from "../i18n";
import { errorCode, errorText, ErrorLine } from "../lib/errors";

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

/** Probe outcome of one capability: the OK case is stored STRUCTURED (not as
 *  text) so a live language switch re-renders it; failures keep the engine's
 *  stable code (ProbeError) plus the raw message, composed at render time. */
type TestOutcome =
  | { ok: true; latencyMs: number; dimension?: number }
  | { ok: false; code?: string; message: string };

/** The KI-Anbieter section: connections list, add/edit dialog with per-
 *  capability tests, offline switch. Rendered by Settings above the model
 *  import block. */
export function ProviderSettings() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown | null>(null);
  const [form, setForm] = useState<ConnectionForm | null>(null);
  /** capability -> probe outcome (text composed at render time) */
  const [testResults, setTestResults] = useState<Record<string, TestOutcome>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["providers"], queryFn: desktopApi.listProviders });

  const save = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error(t("errors.noConnection"));
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
    onError: (e) => setError(e),
  });

  const offlineMutation = useMutation({
    mutationFn: (on: boolean) => desktopApi.setOffline(on),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["providers"] }),
    onError: (e) => setError(e),
  });

  const remove = useMutation({
    mutationFn: (connectionId: string) => desktopApi.deleteProvider(connectionId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["providers"] }),
    onError: (e) => setError(e),
  });

  async function test(capabilityId: string) {
    if (!form) return;
    setTesting(capabilityId);
    setTestResults((prev) => ({ ...prev, [capabilityId]: { ok: true, latencyMs: 0 } }));
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
      setTestResults((prev) => ({
        ...prev,
        [capabilityId]: { ok: true, latencyMs: result.latencyMs, ...(result.dimension ? { dimension: result.dimension } : {}) },
      }));
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [capabilityId]: { ok: false, code: errorCode(e), message: (e as Error).message },
      }));
    } finally {
      setTesting(null);
    }
  }

  const presetFor = (presetId: string) => data?.presets.find((p) => p.id === presetId);
  const connCaps = (conn: ConnectionView) =>
    Object.entries(data?.capabilities ?? {})
      .filter(([, v]) => v.connectionId === conn.id)
      .map(([k]) => k);

  const testText = (outcome: TestOutcome) =>
    outcome.ok
      ? outcome.dimension != null
        ? t("providers.testOkDim", { latency: outcome.latencyMs, dim: outcome.dimension })
        : t("providers.testOk", { latency: outcome.latencyMs })
      : errorText(outcome).primary;
  /** Dense chip keeps one line: the raw engine message rides as the title. */
  const testTitle = (outcome: TestOutcome): string | undefined =>
    outcome.ok ? undefined : errorText(outcome).detail ?? undefined;

  return (
    <section style={{ marginTop: "var(--space-6)" }}>
      <h2 style={{ fontSize: "1.05rem" }}>{t("providers.title")}</h2>
      <p className="muted" style={{ marginTop: 0, fontSize: "0.9rem" }}>
        {t("providers.intro")}
      </p>

      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", margin: "var(--space-3) 0" }}>
        <button
          className="primary"
          onClick={() => {
            setForm(emptyForm("openai"));
            setTestResults({});
          }}
        >
          {t("providers.add")}
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--space-1)", fontSize: "0.9rem" }}>
          <input
            type="checkbox"
            checked={data?.offline ?? false}
            onChange={(e) => offlineMutation.mutate(e.target.checked)}
          />
          {t("providers.offline")}
        </label>
      </div>

      {error != null && <ErrorLine e={error} style={{ margin: "0 0 var(--space-2)" }} />}

      {!data?.connections.length ? (
        <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
          {t("providers.none")}
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
                <button onClick={() => remove.mutate(conn.id)}>{t("providers.remove")}</button>
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
                  {t("providers.edit")}
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
              <span>{t("common.type")}</span>
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
              <span>{t("providers.name")}</span>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={t("providers.namePlaceholder")} />
            </label>
          </div>

          {form.presetId === "custom" && (
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <span>{t("providers.server")}</span>
              <input
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="http://localhost:1234/v1"
              />
            </label>
          )}

          {PROVIDER_CAPABILITIES.filter((c) => presetFor(form.presetId)?.capabilities.includes(c.id)).map((c) => (
            <div key={c.id} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
              <span style={{ width: "110px", flexShrink: 0 }}>{c.id === "chat" ? t("settings.capChat") : c.id === "embed" ? t("settings.typeEmbed") : c.id === "transcribe" ? t("settings.typeTranscribe") : t("settings.capTts")}</span>
              <input
                value={form.models[c.id] ?? ""}
                onChange={(e) => setForm({ ...form, models: { ...form.models, [c.id]: e.target.value } })}
                placeholder={t("settings.colModel")}
                style={{ flex: 1 }}
              />
              <button onClick={() => test(c.id)} disabled={testing === c.id}>
                {testing === c.id ? t("providers.testing") : t("providers.test")}
              </button>
              {testResults[c.id] !== undefined && testing !== c.id && (
                <span style={{ fontSize: "0.85rem", color: "var(--ink-60)" }} title={testTitle(testResults[c.id])}>
                  {testText(testResults[c.id])}
                </span>
              )}
            </div>
          ))}

          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span>{t("providers.secret")}</span>
            <input
              type="password"
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              placeholder={t("providers.secretPlaceholder")}
              autoComplete="off"
            />
          </label>

          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button className="primary" onClick={() => save.mutate()} disabled={save.isPending || !form.label}>
              {save.isPending ? t("common.saving") : t("providers.save")}
            </button>
            <button onClick={() => { setForm(null); setTestResults({}); }}>{t("common.cancel")}</button>
          </div>
          {save.isError && <ErrorLine e={save.error} />}
        </div>
      )}
    </section>
  );
}
