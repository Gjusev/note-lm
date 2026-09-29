/** Desktop API client: engine ops over the transport adapter, shaped like
 *  src/lib/api.ts (same wire contracts, `_id` fields) so screens stay
 *  portable between the web and desktop frontends. */
import { engineOp, errorMessage, type EngineReply } from "./transport";

async function call<T>(op: string, args: unknown = {}): Promise<T> {
  const reply = await engineOp(op, args) as EngineReply<T>;
  if (!reply.ok) throw new Error(errorMessage(reply));
  return reply.result as T;
}

export interface Notebook { _id: string; title: string; description?: string | null; updatedAt: number }
export interface Source { _id: string; fileName: string; fileType: string; fileSize: number; status: string; url?: string | null; errorMessage?: string | null }
export interface Chunk { _id: string; content: string; chunkIndex: number }
export interface Message { _id: string; role: "user" | "assistant"; content: string; citations?: Array<{ sourceId: string; chunkIndex: number; text: string; fileName?: string }> | null; createdAt: number }
export interface Note { _id: string; title: string; content: string; updatedAt: number }
export interface ClaimAnchorView {
  id: string; relation: string; fileName: string | null; version: number; page: number | null;
  /** Time-range locator of a media anchor (mm:ss in the UI); null otherwise. */
  locator: { startSec: number; endSec: number | null } | null; quote: string;
}
export interface ClaimView {
  _id: string; text: string; origin: "chat" | "user"; status: "active" | "reviewed" | "withdrawn";
  createdAt: number; anchors: ClaimAnchorView[]; pendingReviews: number; reviewReasons: string[];
}
/** Wire shape of review.list (listPendingReviews): from/to versions and the
 *  status come with every proposal; today only pending rows are served, so
 *  decided rows have no wire source yet (noted gap, not fabricated here). */
export interface ReviewProposalView {
  id: string; claimId: string; reason: string; detail: string | null; createdAt: number;
  fromVersion: number; toVersion: number; status: string;
}
export interface EvidenceRef {
  fileName: string | null; page: number | null;
  /** Time-range locator of a time_range anchor; null otherwise. */
  locator: { startSec: number; endSec: number | null } | null;
  quote: string; storageId: string | null; absolutePath: string | null;
}

/** One immutable version of a source (sources.listVersions), oldest first. */
export interface SourceVersionView { id: string; version: number; pageCount: number | null; createdAt: number }

/** Open one source at a resolved version (sources.open): latest, or a given
 *  versionId. absolutePath only when the stored original exists on disk. */
export interface SourceOpenView {
  fileName: string | null; contentType: string | null; version: number;
  pageCount: number | null; absolutePath: string | null;
  sidecarKind: "pages" | "sheet" | "media" | null;
}

/** Recorded calculation row (calculations.run/list); argsJson holds the
 *  exact query {op, column, filter} - the reproducibility record. */
export interface CalculationView {
  id: string; sourceVersionId: string; operation: string; argsJson: string;
  result: string | null; unit: string | null; status: string; error: string | null; createdAt: number;
}
export interface CalcRunArgs {
  notebookId: string; sourceId?: string; sourceVersionId?: string;
  op: "sum" | "avg" | "min" | "max" | "count";
  column: string | number;
  filter?: { column: string | number; equals: string };
}

export interface ProviderPresetView {
  id: string;
  label: string;
  baseUrl: string | null;
  capabilities: string[];
  experimental?: boolean;
}
export interface ConnectionView { id: string; presetId: string; label: string; baseUrl?: string }
export interface ProvidersView {
  presets: ProviderPresetView[];
  connections: ConnectionView[];
  capabilities: Record<string, { connectionId: string; model: string }>;
  offline: boolean;
}
/** All four capabilities with their German labels for the settings UI. */
export const PROVIDER_CAPABILITIES = [
  { id: "chat", label: "Konversation" },
  { id: "embed", label: "Embeddings" },
  { id: "transcribe", label: "Transkription" },
  { id: "tts", label: "Sprachausgabe" },
] as const;

/** Curated catalog entry (I0), as served by the models.catalog op. */
export interface CatalogModelView {
  id: string;
  label: string;
  capability: "chat" | "embed";
  sizeBytes: number;
  license: string;
  sha256: string;
  url: string | null;
  notes: string;
}

/** One learning material row (materials.list = full learning_materials row
 *  wired with _id). providerLabel is NOT part of the row (no such column in
 *  the schema) - no provider attribution is available per material today. */
export interface MaterialView {
  _id: string; type: string; status: "pending" | "generating" | "completed" | "error";
  content: string | null; errorMessage: string | null;
  needsReview: number; createdAt: number; updatedAt: number;
}

export const desktopApi = {
  listNotebooks: () => call<Notebook[]>("notebooks.list"),
  createNotebook: (title: string) => call<{ id: string }>("notebooks.create", { title }),
  listSources: (notebookId: string) => call<Source[]>("sources.list", { notebookId }),
  importFile: (path: string, notebookId: string, fileName: string, fileType: string) =>
    call<{ sourceId: string }>("sources.importFile", { path, notebookId, fileName, fileType }),
  importUrl: (notebookId: string, url: string) => call<{ jobId: string; deduped: boolean }>("imports.create", { notebookId, url }),
  listMessages: (notebookId: string) => call<Message[]>("messages.list", { notebookId }),
  sendChat: (notebookId: string, message: string) =>
    call<{ response: string; citations: Message["citations"]; mode: string; vectorStatus: string; provider: { kind: "local" | "remote"; label: string } | null }>("chat.send", { notebookId, message }),
  listNotes: (notebookId: string) => call<Note[]>("notes.list", { notebookId }),
  createNote: (notebookId: string, title: string, content: string) =>
    call<{ id: string }>("notes.create", { notebookId, title, content }),
  updateNote: (noteId: string, title: string, content: string) =>
    call<{}>("notes.update", { noteId, title, content }),
  deleteNote: (noteId: string) => call<{}>("notes.delete", { noteId }),
  activeProfile: () => call<{ profile: { _id: string; model: string; dimension: number } | null }>("retrieval.profile.active"),
  diagnostics: () => call<{ vecVersion: string | null; localChatConfigured: boolean; localEmbedConfigured: boolean }>("diagnostics.capabilities"),
  listModels: () => call<{ models: Array<{ _id: string; capability: "chat" | "embeddings"; fileName: string; sizeBytes: number; sha256: string; status: string; origin: string | null }>; activeChatModelId: string | null; activeEmbedModelId: string | null }>("models.list"),
  importModel: (path: string, capability: "chat" | "embeddings") =>
    call<{ model: { _id: string }; deduped: boolean }>("models.importFile", { path, capability }),
  selectModel: (modelId: string, capability: "chat" | "embeddings") =>
    call<{}>("models.select", { modelId, capability }),
  /** Curated catalog (I0) + user-initiated download of one entry. */
  listCatalogModels: () => call<{ entries: CatalogModelView[] }>("models.catalog"),
  downloadCatalogModel: (
    entry: Pick<CatalogModelView, "url" | "capability" | "sha256">
  ) =>
    call<{ model: { _id: string } }>("models.download", {
      url: entry.url,
      capability: entry.capability === "embed" ? "embeddings" : "chat",
      fileName: entry.url!.split("/").pop(),
      sha256: entry.sha256,
    }),
  listMaterials: (notebookId: string) => call<MaterialView[]>("materials.list", { notebookId }),
  requestMaterial: (notebookId: string, type: string) =>
    call<{ id: string }>("materials.request", { notebookId, type }),
  listJobs: () => call<{ jobs: Array<{ kind: "processing" | "import" | "material"; id: string; notebookId: string; title: string; status: string; intent: "run" | "pause" | "cancel"; updatedAt: number }>; schedulerPaused: boolean }>("jobs.list", {}),
  /** Global scheduler pause (close/tray slice): "Pausieren und beenden"
   *  persists it via the engine; the activity screen offers the way back. */
  schedulerPause: () => call<{ paused: boolean }>("scheduler.pause"),
  schedulerResume: () => call<{ paused: boolean }>("scheduler.resume"),
  jobAction: (kind: string, jobId: string, action: "pause" | "resume" | "cancel") =>
    call<{ intent: string }>(`jobs.${action}`, { kind, jobId }),
  eventsSince: (cursor: number) =>
    call<{ events: Array<{ seq: number; jobKind: string; jobId: string; type: string; payload: string | null }>; cursor: number }>("jobs.eventsSince", { cursor }),
  exportNotebook: (notebookId: string, targetDir: string) =>
    call<{ documents: number; files: number }>("notebook.export", { notebookId, targetDir }),
  importNotebook: (sourceDir: string) =>
    call<{ notebookId: string; documents: number }>("notebook.import", { sourceDir }),
  /** Optional explicit anchors (workspace redesign D1): the op accepts
   *  {sourceId, page, quote} and binds each anchor to the source's LATEST
   *  version - never to the version the user is currently reading. The UI
   *  states that honestly when an older version is open. */
  createClaim: (notebookId: string, text: string, anchors?: Array<{ sourceId: string; page?: number; quote?: string }>) =>
    call<{ id: string; anchorCount: number }>("claims.create", { notebookId, text, ...(anchors ? { anchors } : {}) }),
  createClaimFromMessage: (notebookId: string, messageId: string, text: string) =>
    call<{ id: string; anchorCount: number }>("claims.createFromMessage", { notebookId, messageId, text }),
  listClaims: (notebookId: string) => call<ClaimView[]>("claims.list", { notebookId }),
  listReviews: (notebookId: string) => call<ReviewProposalView[]>("review.list", { notebookId }),
  resolveReview: (proposalId: string, decision: "accepted" | "rejected") =>
    call<{}>("review.resolve", { proposalId, decision }),
  openEvidence: (anchorId: string) => call<EvidenceRef>("evidence.open", { anchorId }),
  listVersions: (sourceId: string) => call<SourceVersionView[]>("sources.listVersions", { sourceId }),
  /** Open one source at a resolved version (latest, or versionId). Desktop
   *  follow-up: the SourceReader panel currently opens files via evidence
   *  anchors; wiring sources.open into it is a small hook for the desktop
   *  agent — the API wrapper here is the only piece landed now. */
  openSource: (sourceId: string, versionId?: string) =>
    call<SourceOpenView>("sources.open", { sourceId, ...(versionId ? { versionId } : {}) }),
  /** Re-import as a new immutable version; identical bytes return
   *  { unchanged: true }, changed bytes enqueue processing { jobId }. */
  reimportVersion: (sourceId: string, path: string, fileName?: string) =>
    call<{ unchanged: boolean; jobId?: string }>("sources.reimportVersion", {
      sourceId, path, ...(fileName ? { fileName } : {}),
    }),
  /** Deterministic sheet op; typed engine errors surface as Error.message
   *  (already German) - codes stay engine-side. */
  runCalculation: (args: CalcRunArgs) => call<CalculationView>("calculations.run", args),
  listCalculations: (notebookId: string) => call<CalculationView[]>("calculations.list", { notebookId }),
  listProviders: () => call<ProvidersView>("providers.list"),
  saveProvider: (
    connection: { id?: string; presetId: string; label: string; baseUrl?: string },
    models: Partial<Record<string, string>>
  ) => call<{ id: string }>("providers.save", { connection, models }),
  deleteProvider: (connectionId: string) => call<{}>("providers.delete", { connectionId }),
  testProvider: (
    capability: string,
    connection: { presetId: string; baseUrl?: string; model?: string },
    secret?: string
  ) => call<{ capability: string; latencyMs: number; dimension?: number }>("providers.test", { capability, connection, secret }),
  setOffline: (on: boolean) => call<{ offline: boolean }>("settings.offline", { on }),
};

/** Native file dialog via the Tauri plugin; null in browser dev. */
export async function pickFile(): Promise<{ path: string; name: string } | null> {
  if (typeof window === "undefined" || !("__TAURI__" in window)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dialog = (window as any).__TAURI__.dialog;
  const path = await dialog.open({ multiple: false, directory: false });
  if (!path || typeof path !== "string") return null;
  const name = path.split(/[\\/]/).pop() || "datei";
  return { path, name };
}

/** Tauri asset-protocol URL for a stored file path (asset:// on macOS/Linux,
 *  http://asset.localhost on Windows). Null in browser dev: no Rust host, no
 *  asset protocol - callers keep the quote-only view instead of a broken src. */
export function assetUrl(path: string): string | null {
  if (typeof window === "undefined" || !("__TAURI__" in window)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convert = (window as any).__TAURI__.core?.convertFileSrc as ((p: string) => string) | undefined;
  return typeof convert === "function" ? convert(path) : null;
}

/** Onboarding sample (strategy §9): the Rust command composes the engine ops
 *  (notebook + v1 sample import + claim) and polls until the sample source
 *  has finished processing. Browser dev has no Rust host for it. */
export async function createSampleNotebook(): Promise<{
  notebookId: string;
  sourceId: string;
  claimId: string;
}> {
  if (typeof window === "undefined" || !("__TAURI__" in window)) {
    throw new Error("Beispiel-Notizbuch ist nur in der Desktop-App verfügbar");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (window as any).__TAURI__.core.invoke("create_sample_notebook");
}

/** Open a stored evidence file with its platform default app. The Rust side
 *  validates the path against the engine data dir; null in browser dev. */
export async function openExternalFile(path: string): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI__" in window)) {
    throw new Error("Dateiöffnung nur in der Desktop-App verfügbar");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (window as any).__TAURI__.core.invoke("open_external_file", { path });
}

/**
 * Save (or clear, value = "") a connection's secret. Desktop: the Rust
 * keyring command — the value never lands in settings or React state after
 * the await. Browser dev: the dev-only providers.setSecret engine op
 * (S1 dev path: the ai.secrets settings row).
 */
export async function saveConnectionSecret(connectionId: string, value: string): Promise<void> {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).__TAURI__.core.invoke("set_connection_secret", { connectionId, value });
    return;
  }
  await call("providers.setSecret", { connectionId, secret: value });
}
