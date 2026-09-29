import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSampleNotebook,
  desktopApi,
  saveConnectionSecret,
  type CatalogModelView,
  type ProvidersView,
} from "./lib/api";

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

const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

type RowState = "ok" | "missing" | "installing" | "checking" | "error";

const ROW_CHIP: Record<RowState, { text: string; bg: string; fg: string }> = {
  ok: { text: "Bereit", bg: "var(--status-success)", fg: "var(--status-success-fg)" },
  missing: { text: "Nicht konfiguriert", bg: "var(--chip-neutral-bg)", fg: "var(--chip-neutral-fg)" },
  installing: { text: "Wird installiert…", bg: "var(--status-info)", fg: "var(--status-info-fg)" },
  checking: { text: "Wird geprüft…", bg: "var(--status-info)", fg: "var(--status-info-fg)" },
  error: { text: "Motor nicht erreichbar", bg: "var(--status-error)", fg: "var(--status-error-fg)" },
};

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
          {chip.text}
        </span>
        {action}
      </span>
    </li>
  );
}

/** Small defaults the wizard recommends (catalog ids, see model-catalog.ts). */
const RECOMMENDED = new Set(["qwen2.5-0.5b-instruct-q4-k-m", "bge-small-en-v1.5-q8-0"]);

const STEP_NAMES = ["Ressourcen-Erkennung", "KI einrichten", "Beispiel laden"];

function Welcome() {
  return (
    <div>
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>Willkommen bei note-lm</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
        Notizbücher, Quellen und Textsuche funktionieren ohne jedes Setup. Diese Einführung
        prüft in drei Schritten, was auf diesem Computer bereits bereit ist:
      </p>
      <ol style={{ margin: 0, paddingLeft: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        {STEP_NAMES.map((name, i) => (
          <li key={name}>
            <span className="mono" style={{ textTransform: "none", letterSpacing: "0.04em" }}>
              {i + 1}. {name}
            </span>
          </li>
        ))}
      </ol>
      <p className="muted" style={{ margin: "var(--space-4) 0 0", fontSize: "0.85rem" }}>
        Jeder Schritt ist überspringbar — <kbd>Escape</kbd> schließt die Einführung jederzeit.
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

  const fixAi = <button onClick={props.onFixAi}>Einrichten</button>;

  return (
    <div>
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>Ressourcen-Erkennung</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0" }}>
        Automatisch geprüft — Stand dieser Installation.
      </p>
      {props.engineDown && (
        <p role="alert" style={{ color: "var(--accent)", margin: "0 0 var(--space-2)" }}>
          Motor nicht erreichbar — Einführung später erneut starten (Einstellungen).
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        <Row
          label="KI-Chat"
          sub={chatOk ? (chatRemote ? `${connLabel(chatRemote.connectionId)} · ${chatRemote.model}` : "Auf diesem Computer") : "Noch kein Modell oder Anbieter gewählt"}
          state={props.diagFetching ? "checking" : chatOk ? "ok" : props.diag ? "missing" : "error"}
          action={chatOk ? undefined : props.diag ? fixAi : undefined}
        />
        <Row
          label="Embeddings"
          sub={
            embedOk
              ? props.profile?.profile
                ? `${props.profile.profile.model} · ${props.profile.profile.dimension} Dim.`
                : "Konfiguriert"
              : "Semantische Suche (Vektorsuche) — ohne bleibt die Textsuche aktiv"
          }
          state={props.diagFetching ? "checking" : embedOk ? "ok" : props.diag ? "missing" : "error"}
          action={embedOk ? undefined : props.diag ? fixAi : undefined}
        />
        <Row
          label="Transkription"
          sub={
            transcribeRemote
              ? `${connLabel(transcribeRemote.connectionId)} · ${transcribeRemote.model}`
              : props.whisper?.installed
                ? `Whisper-Laufzeit ${props.whisper.version} installiert — Modell noch wählen`
                : "Audio/Video-Transkription (Whisper)"
          }
          state={
            props.whisperFetching ? "checking"
              : transcribeRemote ? "ok"
              : props.whisper ? (props.whisper.installed ? "missing" : props.whisper.partialBytes > 0 ? "installing" : "missing")
              : props.providers ? "missing" : "error"
          }
          action={transcribeRemote ? undefined : props.providers ? (
            <button onClick={props.onGoSettings}>Einstellungen</button>
          ) : undefined}
        />
        {/* FFmpeg + llama.cpp ship inside the app package — nothing to detect */}
        <Row label="FFmpeg" sub="Medien-Verarbeitung (mitgeliefert)" state="ok" />
        <Row label="llama.cpp" sub="Lokale Modellausführung (mitgeliefert)" state="ok" />
        <Row
          label="Modelle auf Festplatte"
          sub={
            modelRows.length
              ? `${modelRows.length} Modell${modelRows.length === 1 ? "" : "e"} · ${mb(totalBytes)}`
              : "Noch keine lokalen Modelle heruntergeladen"
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
  const [error, setError] = useState<string | null>(null);

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
    onError: (e) => setError(e.message),
  });

  // (b) API: the ProviderSettings save+test flow against the same ops
  const [form, setForm] = useState({ presetId: "openai", label: "", baseUrl: "", chatModel: "", secret: "" });
  const [testResult, setTestResult] = useState<string | null>(null);
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
      setTestResult(`Verbindung OK (${result.latencyMs} ms)`);
    } catch (e) {
      setTestResult((e as Error).message);
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
    onError: (e) => setError(e.message),
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
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>KI einrichten</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-3)" }}>
        Chat und semantische Suche brauchen ein Modell — lokal auf diesem Computer oder über
        einen API-Anbieter. Ohne Auswahl bleibt note-lm ehrlich auf Textsuche.
      </p>
      <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "flex-start" }}>
        {card("local", "Lokal — Privat", "Modelle werden von Hugging Face geladen, geprüft und laufen nur auf diesem Computer.", (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {props.catalogLoading && <p className="muted" style={{ margin: 0 }}>Katalog lädt…</p>}
            {props.catalog
              .filter((e) => (e.capability === "chat" || e.capability === "embed") && e.url)
              .map((entry) => {
                const busy = install.isPending && install.variables?.id === entry.id;
                return (
                  <div key={entry.id} style={{ borderTop: "1px solid var(--rule)", paddingTop: "var(--space-2)" }}>
                    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                      <strong style={{ flex: 1, fontSize: "0.88rem" }}>{entry.label}</strong>
                      {RECOMMENDED.has(entry.id) && (
                        <span className="chip" style={{ background: "var(--status-info)", color: "var(--status-info-fg)" }}>Empfohlen</span>
                      )}
                    </div>
                    <div className="mono" style={{ textTransform: "none", letterSpacing: "0.04em", margin: "var(--space-1) 0", fontSize: "0.72rem" }}>
                      {entry.capability === "chat" ? "Chat" : "Embeddings"} · {mb(entry.sizeBytes)} · {entry.license}
                    </div>
                    <button
                      className="primary"
                      disabled={install.isPending}
                      onClick={() => install.mutate(entry)}
                    >
                      {busy ? `Wird geladen… (${mb(entry.sizeBytes)})` : "Herunterladen & aktivieren"}
                    </button>
                  </div>
                );
              })}
            <p className="muted" style={{ margin: 0, fontSize: "0.78rem" }}>
              Der Download läuft ununterbrochen im Hintergrund des Engine-Prozesses und ist erst
              nach der Prüfsummenprüfung nutzbar — daher Fortschritt ohne Prozentanzeige.
            </p>
          </div>
        ))}
        {card("api", "API-Anbieter", "OpenAI-kompatibler Anbieter mit Schlüssel; Zugangsdaten landen im Betriebssystem-Schlüsselbund.", (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
              Typ
              <select value={form.presetId} onChange={(e) => setForm({ ...form, presetId: e.target.value })}>
                {apiPresets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
              Name
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="z. B. Mein OpenRouter" />
            </label>
            {form.presetId === "custom" && (
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
                Serveradresse
                <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://localhost:1234/v1" />
              </label>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
              Chat-Modell
              <input value={form.chatModel} onChange={(e) => setForm({ ...form, chatModel: e.target.value })} placeholder="z. B. gpt-4o-mini" />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)", fontSize: "0.88rem" }}>
              Zugangsdaten (API-Schlüssel)
              <input type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} autoComplete="off" placeholder="Wird im Schlüsselbund gespeichert" />
            </label>
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={test} disabled={testing}> {testing ? "Teste…" : "Verbindung testen"} </button>
              <button className="primary" onClick={() => save.mutate()} disabled={save.isPending || !form.label || !form.chatModel}>
                {save.isPending ? "Speichere…" : "Speichern & aktivieren"}
              </button>
            </div>
            {testResult && <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>{testResult}</p>}
          </div>
        ))}
      </div>

      {/* (c) honest later: no fake readiness */}
      <div style={{ marginTop: "var(--space-3)", borderTop: "1px solid var(--rule)", paddingTop: "var(--space-3)" }}>
        <button onClick={props.onDone}>Später — Nur Textsuche</button>
        <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: "0.82rem" }}>
          Chat und semantische Suche bleiben dann außerhalb der Textsuche inaktiv, bis du sie
          unter Einstellungen einrichtest. Notizbücher, Quellen, Notizen und Textsuche
          funktionieren vollständig ohne.
        </p>
      </div>
      {error && <p role="alert" style={{ color: "var(--accent)", margin: "var(--space-2) 0 0" }}>{error}</p>}
    </div>
  );
}

/** Step 3: sample notebook or empty start. */
function SampleOffer(props: { onDone: (notebookId: string | null) => void }) {
  const [sampling, setSampling] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>Beispiel laden</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
        Mit einem Klick entsteht ein Notizbuch mit einer verknüpften Studie in zwei Versionen —
        inklusive einer Aussage, deren Beleg sich beim Update ändert. Oder leer beginnen.
      </p>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <button className="primary" onClick={withSample} disabled={sampling}>
          {sampling ? "Beispiel wird geladen…" : "Mit Beispiel starten"}
        </button>
        <button onClick={() => props.onDone(null)} disabled={sampling}>Leer beginnen</button>
      </div>
      {error && <p role="alert" style={{ color: "var(--accent)", margin: "var(--space-2) 0 0" }}>{error}</p>}
    </div>
  );
}

/** Finish: flag is already set, honest keyboard hints only. */
function Finish(props: { notebookId: string | null; onDone: () => void }) {
  return (
    <div>
      <h2 id="onboarding-title" style={{ margin: 0, fontSize: "1.15rem" }}>Fertig — Los geht's</h2>
      <p className="muted" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>
        {props.notebookId
          ? "Das Beispiel-Notizbuch ist bereit und öffnet sich nach dem Schließen."
          : "Die Bibliothek ist leer und wartet auf dein erstes Notizbuch."}
      </p>
      <p style={{ margin: "0 0 var(--space-4)" }}>
        <kbd>Escape</kbd> schließt Panels und Dialoge. Die Einführung lässt sich jederzeit in
        den Einstellungen erneut starten.
      </p>
      <button className="primary" onClick={props.onDone}>Los geht's</button>
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
            {step < 3 && <button className="primary" onClick={() => setStep(step + 1)}>Weiter</button>}
            {step > 0 && <button onClick={() => { setStep(step - 1); setChoice(null); }}>Zurück</button>}
            <span className="meta" style={{ marginLeft: "auto" }} aria-hidden="true">
              {step < 3 ? `Schritt ${step + 1}/3` : ""}
            </span>
            <button onClick={close}>Überspringen</button>
          </div>
        )}
      </div>
    </div>
  );
}
