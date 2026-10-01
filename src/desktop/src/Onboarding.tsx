import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSampleNotebook,
  desktopApi,
  saveConnectionSecret,
  type CatalogModelView,
  type ProvidersView,
} from "./lib/api";
import { LangSelect, fmtMB, t } from "./i18n";
import { errorCode, errorText, ErrorLine } from "./lib/errors";

/**
 * First-run onboarding wizard (strategy §9): welcome -> resource recognition
 * -> AI setup (local, API, or honest "later") -> sample offer. Skippable at
 * every point ("Überspringen" and Escape both close AND set the flag), re-
 * openable from Settings via the "notelm:onboarding" window event.
 *
 * Trigger: localStorage flag "notelm.onboarded" absent AND (no notebooks OR
 * no AI configured). Engine unreachable counts as a probable first run too —
 * the wizard then shows the honest "Motor nicht erreichbar" state instead of
 * blocking anything (every op here is display-only until the user acts).
 *
 * Resource recognition composes EXISTING ops only: diagnostics.capabilities,
 * providers.list, runtimes.whisper {status}, models.list,
 * retrieval.profile.active. AI setup reuses the ProviderSettings save+test
 * flow (desktopApi.saveProvider/testProvider/saveConnectionSecret) and the
 * Settings catalog download path (models.download + models.select).
 */

const FLAG = "notelm.onboarded";
/** Settings dispatches this to re-open the wizard ("Einführung erneut starten"). */
export const ONBOARDING_EVENT = "notelm:onboarding";

/** One checklist row: mono label, honest status chip, optional fix action.
 *  Chip + action sit in one right-aligned group with a fixed chip width, so
 *  the status column lines up whether or not a row carries an action. */
function Row({ label, sub, state, action }: {
  label: string;
  sub?: string;
  state: RowState;
  action?: ReactNode;
}) {
  const chip = ROW_CHIP[state];
  return (
    <li style={{
      display: "flex", alignItems: "center", gap: "var(--space-3)",
      padding: "var(--space-2) 0", borderBottom: "1px solid var(--rule)",
    }}>
      <span className="mono" style={{ flex: "0 0 165px", textTransform: "none", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: "0.88rem" }}>{sub}</span>
      <span style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", justifyContent: "flex-end" }}>
        <span className="chip" style={{ background: chip.bg, color: chip.fg, minWidth: 152, justifyContent: "center" }}>
          {t(chip.key)}
        </span>
        {action}
      </span>
    </li>
  );
}

type RowState = "ok" | "missing" | "installing" | "checking" | "error";

/** Chip visuals per row state; the text is a translation key (live switch). */
const ROW_CHIP: Record<RowState, { key: string; bg: string; fg: string }> = {
  ok: { key: "onboarding.chipOk", bg: "var(--status-success)", fg: "var(--status-success-fg)" },
  missing: { key: "onboarding.chipMissing", bg: "var(--chip-neutral-bg)", fg: "var(--chip-neutral-fg)" },
  installing: { key: "onboarding.chipInstalling", bg: "var(--status-info)", fg: "var(--status-info-fg)" },
  checking: { key: "onboarding.chipChecking", bg: "var(--status-info)", fg: "var(--status-info-fg)" },
  error: { key: "app.status.engineDown", bg: "var(--status-error)", fg: "var(--status-error-fg)" },
};

/** Small defaults the wizard recommends (catalog ids, see model-catalog.ts). */
const RECOMMENDED = new Set(["qwen2.5-0.5b-instruct-q4-k-m", "bge-small-en-v1.5-q8-0"]);

const STEP_KEYS = ["onboarding.step1", "onboarding.step2", "library.loadSample"];

function Welcome() {
  return (
    <div>
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>{t("onboarding.welcomeTitle")}</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
        {t("onboarding.welcomeIntro")}
      </p>
      <ol style={{ margin: 0, paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {STEP_KEYS.map((key, i) => (
          <li key={key}>
            <span className="mono" style={{ textTransform: "none", letterSpacing: "0.04em" }}>
              {i + 1}. {t(key)}
            </span>
          </li>
        ))}
      </ol>
      {/* Language picker: switching applies immediately and persists. */}
      <p style={{ margin: "var(--space-3) 0 0" }}>
        <LangSelect />
      </p>
      <p className="muted" style={{ margin: "var(--space-3) 0 0", fontSize: "0.85rem" }}>
        {t("onboarding.skipHintA")} <kbd>Escape</kbd> {t("onboarding.skipHintB")}
      </p>
    </div>
  );
}

/** Step 1: the live resource checklist (auto-scan, statuses from real ops). */
function Resources(props: {
  engineDown: boolean;
  diag: { vecVersion: string | null; localChatConfigured: boolean; localEmbedConfigured: boolean } | undefined;
  diagFetching: boolean;
  providers: ProvidersView | undefined;
  whisper: { installed: boolean; version: string; partialBytes: number } | undefined;
  whisperFetching: boolean;
  models: { models: Array<{ _id: string; capability: "chat" | "embeddings"; fileName: string; sizeBytes: number; status: string }> } | undefined;
  profile: { profile: { _id: string; model: string; dimension: number } | null } | undefined;
  onFixAi: () => void;
  onGoSettings: () => void;
}) {
  const chatRemote = props.providers?.capabilities.chat;
  const embedRemote = props.providers?.capabilities.embed;
  const transcribeRemote = props.providers?.capabilities.transcribe;
  /** Human label of the connection a capability points at. */
  const connLabel = (connectionId: string) => {
    const conn = props.providers?.connections.find((c) => c.id === connectionId);
    const preset = props.providers?.presets.find((p) => p.id === conn?.presetId);
    return conn?.label || preset?.label || connectionId;
  };

  const chatOk = !!(props.diag?.localChatConfigured || chatRemote);
  const embedOk = !!(props.diag?.localEmbedConfigured || embedRemote);

  const modelRows = props.models?.models ?? [];
  const totalBytes = modelRows.reduce((sum, m) => sum + m.sizeBytes, 0);

  const fixAi = <button onClick={props.onFixAi}>{t("onboarding.fixAi")}</button>;

  return (
    <div>
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>{t("onboarding.step1")}</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0" }}>
        {t("onboarding.resourcesIntro")}
      </p>
      {props.engineDown && (
        <p role="alert" style={{ color: "var(--accent)", margin: "0 0 var(--space-2)" }}>
          {t("onboarding.engineDown")}
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <Row
          label={t("onboarding.rowChat")}
          sub={chatOk ? (chatRemote ? `${connLabel(chatRemote.connectionId)} · ${chatRemote.model}` : t("app.status.local")) : t("onboarding.subNoModel")}
          state={props.diagFetching ? "checking" : chatOk ? "ok" : props.diag ? "missing" : "error"}
          action={chatOk ? undefined : props.diag ? fixAi : undefined}
        />
        <Row
          label={t("settings.typeEmbed")}
          sub={
            embedOk
              ? props.profile?.profile
                ? t("onboarding.dims", { model: props.profile.profile.model, n: props.profile.profile.dimension })
                : t("onboarding.configured")
              : t("onboarding.embedMissing")
          }
          state={props.diagFetching ? "checking" : embedOk ? "ok" : props.diag ? "missing" : "error"}
          action={embedOk ? undefined : props.diag ? fixAi : undefined}
        />
        <Row
          label={t("settings.typeTranscribe")}
          sub={
            transcribeRemote
              ? `${connLabel(transcribeRemote.connectionId)} · ${transcribeRemote.model}`
              : props.whisper?.installed
                ? t("onboarding.whisperInstalled", { version: props.whisper.version })
                : t("onboarding.whisperMissing")
          }
          state={
            props.whisperFetching ? "checking"
              : transcribeRemote ? "ok"
              : props.whisper ? (props.whisper.installed ? "missing" : props.whisper.partialBytes > 0 ? "installing" : "missing")
              : props.providers ? "missing" : "error"
          }
          action={transcribeRemote ? undefined : props.providers ? (
            <button onClick={props.onGoSettings}>{t("app.settings")}</button>
          ) : undefined}
        />
        {/* FFmpeg + llama.cpp ship inside the app package — nothing to detect */}
        <Row label="FFmpeg" sub={t("onboarding.ffmpegSub")} state="ok" />
        <Row label="llama.cpp" sub={t("onboarding.llamaSub")} state="ok" />
        <Row
          label={t("onboarding.rowModels")}
          sub={
            modelRows.length
              ? t("onboarding.modelsOnDisk", { n: modelRows.length, size: fmtMB(totalBytes) })
              : t("onboarding.noLocalModels")
          }
          state={props.models ? (modelRows.length ? "ok" : "missing") : props.engineDown ? "error" : "checking"}
        />
      </ul>
    </div>
  );
}

/** Step 2: three cards — local models, API provider, or honest "later". */
function AiSetup(props: {
  choice: "local" | "api" | null;
  onChoice: (c: "local" | "api" | null) => void;
  presets: ProvidersView["presets"];
  catalog: CatalogModelView[];
  catalogLoading: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown | null>(null);

  // (a) local: download + activate one catalog entry (Settings' flow). The
  // engine op resolves only when the sha-verified file is complete — honest
  // spinner + size, no fake percentage (models have no partial events).
  const install = useMutation({
    mutationFn: async (entry: CatalogModelView) => {
      const { model } = await desktopApi.downloadCatalogModel(entry);
      await desktopApi.selectModel(model._id, entry.capability === "embed" ? "embeddings" : "chat");
      return entry.id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ob"] });
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      props.onDone();
    },
    onError: (e) => setError(e),
  });

  // (b) API: the ProviderSettings save+test flow against the same ops.
  // The OK result is stored STRUCTURED so a live language switch re-renders
  // it; engine errors stay verbatim strings.
  const [form, setForm] = useState({ presetId: "openai", label: "", baseUrl: "", chatModel: "", secret: "" });
  const [testResult, setTestResult] = useState<{ ok: true; latencyMs: number } | { ok: false; code?: string; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const apiPresets = props.presets.filter(
    (p) => !p.experimental && p.capabilities.includes("chat") && p.id !== "llamacpp"
  );
  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await desktopApi.testProvider(
        "chat",
        {
          presetId: form.presetId,
          ...(form.baseUrl ? { baseUrl: form.baseUrl } : {}),
          ...(form.chatModel ? { model: form.chatModel } : {}),
        },
        form.secret || undefined
      );
      setTestResult({ ok: true, latencyMs: result.latencyMs });
    } catch (e) {
      setTestResult({ ok: false, code: errorCode(e), message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };
  const save = useMutation({
    mutationFn: async () => {
      const { id } = await desktopApi.saveProvider(
        {
          presetId: form.presetId,
          label: form.label,
          ...(form.baseUrl ? { baseUrl: form.baseUrl } : {}),
        },
        { chat: form.chatModel }
      );
      // the key never persists in React state: cleared right after the save
      if (form.secret) await saveConnectionSecret(id, form.secret);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ob"] });
      void queryClient.invalidateQueries({ queryKey: ["providers"] });
      props.onDone();
    },
    onError: (e) => setError(e),
  });

  const card = (id: "local" | "api", title: string, summary: string, body: ReactNode) => {
    const selected = props.choice === id;
    return (
      <div style={{
        flex: "1 1 160px",
        border: selected ? "var(--rule-structural)" : "1px solid var(--rule)",
        padding: "var(--space-3)",
        display: "flex", flexDirection: "column", gap: "var(--space-2)",
      }}>
        <button aria-expanded={selected} onClick={() => props.onChoice(selected ? null : id)}>
          {title}
        </button>
        <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>{summary}</p>
        {selected && body}
      </div>
    );
  };

  return (
    <div>
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>{t("onboarding.step2")}</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-3)" }}>
        {t("onboarding.aiIntro")}
      </p>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
        {card("local", t("onboarding.localCard"), t("onboarding.localSummary"), (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {props.catalogLoading && <p className="muted" style={{ margin: 0 }}>{t("onboarding.catalogLoading")}</p>}
            {props.catalog
              .filter((e) => (e.capability === "chat" || e.capability === "embed") && e.url)
              .map((entry) => {
                const busy = install.isPending && install.variables?.id === entry.id;
                return (
                  <div key={entry.id} style={{ borderTop: "1px solid var(--rule)", paddingTop: "var(--space-2)" }}>
                    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                      <strong style={{ flex: 1, fontSize: "0.88rem" }}>{entry.label}</strong>
                      {RECOMMENDED.has(entry.id) && (
                        <span className="chip" style={{ background: "var(--status-info)", color: "var(--status-info-fg)" }}>{t("onboarding.recommended")}</span>
                      )}
                    </div>
                    <div className="mono" style={{ textTransform: "none", letterSpacing: "0.04em", margin: "var(--space-1) 0", fontSize: "0.72rem" }}>
                      {entry.capability === "chat" ? t("settings.typeChat") : t("settings.typeEmbed")} · {fmtMB(entry.sizeBytes)} · {entry.license}
                    </div>
                    <button
                      className="primary"
                      disabled={install.isPending}
                      onClick={() => install.mutate(entry)}
                    >
                      {busy ? t("onboarding.downloadingSize", { size: fmtMB(entry.sizeBytes) }) : t("onboarding.downloadActivate")}
                    </button>
                  </div>
                );
              })}
            <p className="muted" style={{ margin: 0, fontSize: "0.78rem" }}>
              {t("onboarding.downloadNote")}
            </p>
          </div>
        ))}
        {card("api", t("onboarding.apiCard"), t("onboarding.apiSummary"), (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
              {t("common.type")}
              <select value={form.presetId} onChange={(e) => setForm({ ...form, presetId: e.target.value })}>
                {apiPresets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
              {t("providers.name")}
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={t("providers.namePlaceholder")} />
            </label>
            {form.presetId === "custom" && (
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
                {t("providers.server")}
                <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://localhost:1234/v1" />
              </label>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
              {t("onboarding.chatModel")}
              <input value={form.chatModel} onChange={(e) => setForm({ ...form, chatModel: e.target.value })} placeholder={t("onboarding.chatModelPlaceholder")} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
              {t("providers.secret")}
              <input type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} autoComplete="off" placeholder={t("onboarding.secretShort")} />
            </label>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={test} disabled={testing}> {testing ? t("providers.testing") : t("providers.test")} </button>
              <button className="primary" onClick={() => save.mutate()} disabled={save.isPending || !form.label || !form.chatModel}>
                {save.isPending ? t("common.saving") : t("onboarding.saveActivate")}
              </button>
            </div>
            {testResult && (
              <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }} title={testResult.ok ? undefined : errorText(testResult).detail ?? undefined}>
                {testResult.ok ? t("providers.testOk", { latency: testResult.latencyMs }) : errorText(testResult).primary}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* (c) honest later: no fake readiness */}
      <div style={{ marginTop: "var(--space-3)", borderTop: "1px solid var(--rule)", paddingTop: "var(--space-3)" }}>
        <button onClick={props.onDone}>{t("onboarding.later")}</button>
        <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: "0.82rem" }}>
          {t("onboarding.laterNote")}
        </p>
      </div>
      {error != null && <ErrorLine e={error} style={{ margin: "var(--space-2) 0 0" }} />}
    </div>
  );
}

/** Step 3: sample notebook or empty start. */
function SampleOffer(props: { onDone: (notebookId: string | null) => void }) {
  const [sampling, setSampling] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  const withSample = async () => {
    setSampling(true);
    setError(null);
    try {
      const data = await createSampleNotebook();
      props.onDone(data.notebookId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSampling(false);
    }
  };

  return (
    <div>
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>{t("library.loadSample")}</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
        {t("onboarding.sampleIntro")}
      </p>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <button className="primary" onClick={withSample} disabled={sampling}>
          {sampling ? t("library.sampling") : t("onboarding.startWithSample")}
        </button>
        <button onClick={() => props.onDone(null)} disabled={sampling}>{t("onboarding.startEmpty")}</button>
      </div>
      {error != null && <ErrorLine e={error} style={{ margin: "var(--space-2) 0 0" }} />}
    </div>
  );
}

/** Finish: flag is already set, honest keyboard hints only. */
function Finish(props: { notebookId: string | null; onDone: () => void }) {
  return (
    <div>
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>{t("onboarding.finishTitle")}</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
        {props.notebookId ? t("onboarding.finishWithSample") : t("onboarding.finishEmpty")}
      </p>
      <p style={{ margin: "0 0 var(--space-4)" }}>
        <kbd>Escape</kbd> {t("onboarding.finishHint")}
      </p>
      <button className="primary" onClick={props.onDone}>{t("onboarding.go")}</button>
    </div>
  );
}

export function Onboarding() {
  const queryClient = useQueryClient();
  const [forced, setForced] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [flagSet] = useState(() => localStorage.getItem(FLAG) === "1");
  // 0 welcome, 1 resources, 2 ai, 3 sample, 4 finish
  const [step, setStep] = useState(0);
  const [choice, setChoice] = useState<"local" | "api" | null>(null);
  const [sampledNotebook, setSampledNotebook] = useState<string | null>(null);

  // --- trigger: first run = flag absent AND (no notebooks OR no AI) ----------
  const notebooks = useQuery({ queryKey: ["notebooks"], queryFn: desktopApi.listNotebooks, retry: 1 });
  const diag = useQuery({ queryKey: ["ob", "diag"], queryFn: desktopApi.diagnostics, retry: 1 });
  const providers = useQuery({ queryKey: ["ob", "providers"], queryFn: desktopApi.listProviders, retry: 1 });

  useEffect(() => {
    const onRestart = () => { setDismissed(false); setForced(true); };
    window.addEventListener(ONBOARDING_EVENT, onRestart);
    return () => window.removeEventListener(ONBOARDING_EVENT, onRestart);
  }, []);

  const aiConfigured = !!(
    diag.data?.localChatConfigured || diag.data?.localEmbedConfigured || providers.data?.capabilities.chat
  );
  const firstRun = (notebooks.data?.length ?? 0) === 0 || !aiConfigured;
  const open = !dismissed && (
    forced // Settings restart bypasses the flag by design
    || !flagSet && (
      (notebooks.isSuccess && diag.isSuccess && firstRun)
      || notebooks.isError // engine down + no flag: probable first run, honest error state
    )
  );

  // --- resource-recognition queries: only while the dialog is open ----------
  const whisper = useQuery({
    queryKey: ["ob", "whisper"], queryFn: desktopApi.whisperRuntimeStatus,
    enabled: open, retry: 1,
  });
  const models = useQuery({ queryKey: ["ob", "models"], queryFn: desktopApi.listModels, enabled: open, retry: 1 });
  const profile = useQuery({ queryKey: ["ob", "profile"], queryFn: desktopApi.activeProfile, enabled: open, retry: 1 });
  const catalog = useQuery({
    queryKey: ["catalog"], queryFn: desktopApi.listCatalogModels,
    enabled: open && step === 2, retry: 1,
  });

  // Re-scan on every step-1 entry: config success routes through here (or the
  // user steps back), the chips animate through "Wird geprüft…" while refetching.
  useEffect(() => {
    if (open && step === 1) void queryClient.invalidateQueries({ queryKey: ["ob"] });
  }, [open, step, queryClient]);

  // --- close = skip = set the flag (always re-openable from Settings) -------
  const close = () => {
    try { localStorage.setItem(FLAG, "1"); } catch { /* storage blocked: session-only */ }
    if (step === 4 && sampledNotebook) window.location.hash = `#/nb/${sampledNotebook}`;
    setDismissed(true);
    setForced(false);
    setStep(0);
    setChoice(null);
  };

  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const engineDown = diag.isError && providers.isError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "var(--space-4)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); close(); }
        if (e.key === "Tab") {
          // focus trap: cycle inside the dialog
          const els = dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
          );
          if (!els || els.length === 0) return;
          const first = els[0];
          const last = els[els.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          background: "var(--surface)",
          border: "var(--rule-structural)",
          borderRadius: "var(--radius-sharp)",
          padding: "var(--space-6)",
          width: 640, maxWidth: "100%", maxHeight: "100%", overflowY: "auto",
        }}
      >
        {step === 0 && <Welcome />}
        {step === 1 && (
          <Resources
            engineDown={engineDown}
            diag={diag.data}
            diagFetching={diag.isFetching}
            providers={providers.data}
            whisper={whisper.data}
            whisperFetching={whisper.isFetching}
            models={models.data}
            profile={profile.data}
            onFixAi={() => setStep(2)}
            onGoSettings={() => { window.location.hash = "#/settings"; close(); }}
          />
        )}
        {step === 2 && (
          <AiSetup
            choice={choice}
            onChoice={setChoice}
            presets={providers.data?.presets ?? []}
            catalog={catalog.data?.entries ?? []}
            catalogLoading={catalog.isLoading}
            onDone={() => { void queryClient.invalidateQueries({ queryKey: ["ob"] }); setStep(3); }}
          />
        )}
        {step === 3 && (
          <SampleOffer onDone={(notebookId) => { setSampledNotebook(notebookId); setStep(4); }} />
        )}
        {step === 4 && <Finish notebookId={sampledNotebook} onDone={close} />}

        {step < 4 && (
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-6)", paddingTop: "var(--space-4)", borderTop: "var(--rule-structural)", alignItems: "center" }}>
            {step < 3 && <button className="primary" onClick={() => setStep(step + 1)}>{t("onboarding.next")}</button>}
            {step > 0 && <button onClick={() => { setStep(step - 1); setChoice(null); }}>{t("onboarding.back")}</button>}
            <span className="meta" style={{ marginLeft: "auto" }} aria-hidden="true">
              {step < 3 ? t("onboarding.stepOf", { n: step + 1 }) : ""}
            </span>
            <button onClick={close}>{t("onboarding.skip")}</button>
          </div>
        )}
      </div>
    </div>
  );
}
