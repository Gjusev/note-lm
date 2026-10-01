/** Desktop API client: engine ops over the transport adapter, shaped like
 *  src/lib/api.ts (same wire contracts, `_id` fields) so screens stay
 *  portable between the web and desktop frontends. */
import { engineOp, errorMessage, type EngineReply } from "./transport";
import { EngineError } from "./errors";
import { t } from "../i18n";

async function call<T>(op: string, args: unknown = {}): Promise<T> {
  const reply = await engineOp(op, args) as EngineReply<T>;
  // EngineError keeps the reply's stable code — every display point can map
  // it to a localized line (lib/errors), the message stays the detail.
  if (!reply.ok) throw new EngineError(reply.error?.code ?? "unknown", errorMessage(reply));
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
  /** Immutable version row the anchor is pinned to (engine wire field). The
   *  version belongs to exactly one source - the reliable anchor -> source
   *  mapping when the source's fileName has since changed (reimport). */
  sourceVersionId: string;
}
export interface ClaimView {
  _id: string; text: string; origin: "chat" | "user"; status: "active" | "reviewed" | "withdrawn";
  createdAt: number; anchors: ClaimAnchorView[]; pendingReviews: number; reviewReasons: string[];
}
/** Wire shape of review.list (listPendingReviews): from/to versions and the
 *  status come with every proposal; sourceId rides along so version-pinned
 *  opens (proposal comparison) never have to guess the column. */
export interface ReviewProposalView {
  id: string; claimId: string; sourceId: string; reason: string; detail: string | null; createdAt: number;
  fromVersion: number; toVersion: number; status: string;
}

/** Evidence matrix (matrix.get): claims x selected sources, every cell a
 *  derived relationship. not_found_in_search is typed but never served
 *  today (no performed-search provenance store) - honest absence, not a
 *  faked miss. */
export interface MatrixAnchorView {
  anchorId: string; relation: "supports" | "questions"; sourceVersionId: string; version: number;
  page: number | null; locator: { startSec: number; endSec: number | null } | null; quote: string;
}
export interface MatrixProposalView {
  proposalId: string; reason: "quote_moved" | "quote_missing"; fromVersion: number; toVersion: number;
  status: "pending" | "accepted" | "rejected"; detail: string | null; note: string | null; resolvedAt: number | null;
}
/** The performed search behind a not_found_in_search cell (search.run
 *  provenance, migration 0014): what was queried, when, with which recipe.
 *  Null on every other status. */
export interface MatrixSearchProvenance {
  runId: string; query: string; searchedAt: number;
  profileId: string | null; fusionPolicy: string | null;
}
export interface MatrixCellView {
  claimId: string; sourceId: string;
  status: "evidence" | "pending_review" | "not_reviewed" | "not_found_in_search";
  evidence: MatrixAnchorView[]; pendingProposals: MatrixProposalView[]; resolvedProposals: MatrixProposalView[];
  searchProvenance: MatrixSearchProvenance | null;
}
export interface MatrixViewData {
  notebookId: string;
  claims: Array<{ id: string; text: string; status: string }>;
  sources: Array<{ id: string; fileName: string; latestVersion: number | null }>;
  cells: MatrixCellView[];
}
/** Stable cell index key (claim::source), mirrors the engine helper. */
export function matrixCellKey(claimId: string, sourceId: string): string {
  return `${claimId}::${sourceId}`;
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
/** All four capabilities (ids only — labels are translated at the use site,
 *  see settings.capChat/typeEmbed/typeTranscribe/capTts). */
export const PROVIDER_CAPABILITIES = [
  { id: "chat" },
  { id: "embed" },
  { id: "transcribe" },
  { id: "tts" },
] as const;

/** Embedding recipe of a catalog-known embed model (P3): profile identity =
 *  provider + model + revision + dimension + pooling. Only catalog-known
 *  recipes can stage/activate a profile automatically on models.select. */
export interface EmbeddingRecipeView {
  provider: string; model: string; revision: string; dimension: number; pooling: string;
  queryPrefix?: string; docPrefix?: string;
}

/** Curated catalog entry (I0), as served by the models.catalog op. The wire
 *  also carries "transcribe" entries (whisper) — they download through the
 *  settings-tracked "transcriptions" capability, no models-table row. */
export interface CatalogModelView {
  id: string;
  label: string;
  capability: "chat" | "embed" | "transcribe";
  sizeBytes: number;
  license: string;
  sha256: string;
  url: string | null;
  notes: string;
  embeddingRecipe?: EmbeddingRecipeView;
}

/** One hybrid search hit as returned by search.run (searchHybrid hits). */
export interface SearchHitView {
  chunkId: string; sourceId: string; chunkIndex: number; content: string;
  sourceVersionId?: string | null; score: number; branches: Array<"fts" | "vector">;
}
export interface SearchRunResult {
  runId: string;
  /** Scope actually searched (the caller's selection, confined to the
   *  notebook, or every notebook source when unscoped). */
  sourceIds: string[];
  mode: string;
  vectorStatus: string;
  hits: SearchHitView[];
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
      capability: entry.capability === "embed"
        ? "embeddings"
        : entry.capability === "transcribe" ? "transcriptions" : "chat",
      fileName: entry.url!.split("/").pop(),
      sha256: entry.sha256,
    }),
  /** Performed search WITH provenance (search.run): runs hybrid search
   *  scoped to the caller's source selection and records the run — the
   *  evidence matrix's not_found_in_search cells name THIS run. */
  runSearch: (notebookId: string, query: string, sourceIds?: string[]) =>
    call<SearchRunResult>("search.run", {
      notebookId, query, ...(sourceIds ? { sourceIds } : {}),
    }),
  /** Staged-activation companion (P3): resolve the profile for a recipe and
   *  report how many chunks still need vectors — poll while pendingCount > 0
   *  to know when retrieval.profile.activate will pass. */
  profileStatus: (recipe: EmbeddingRecipeView) =>
    call<{ profileId: string; pendingCount: number; dimension: number }>(
      "retrieval.profile.status", recipe
    ),
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
  /** Optional explicit anchors (workspace redesign D1): {sourceId,
   *  versionId?, page?, quote?}. versionId pins the anchor to that immutable
   *  version - the reader captures it at selection time, so a reimport after
   *  the selection cannot re-point the citation. Absent versionId -> the
   *  source's latest version (engine fallback). */
  createClaim: (notebookId: string, text: string, anchors?: Array<{ sourceId: string; versionId?: string; page?: number; quote?: string }>) =>
    call<{ id: string; anchorCount: number }>("claims.create", { notebookId, text, ...(anchors ? { anchors } : {}) }),
  createClaimFromMessage: (notebookId: string, messageId: string, text: string) =>
    call<{ id: string; anchorCount: number }>("claims.createFromMessage", { notebookId, messageId, text }),
  listClaims: (notebookId: string) => call<ClaimView[]>("claims.list", { notebookId }),
  listReviews: (notebookId: string) => call<ReviewProposalView[]>("review.list", { notebookId }),
  /** Evidence matrix: optional claim/source subsets; explicit sourceIds keep
   *  zero-relation sources as not_reviewed columns (correction 1). */
  getMatrix: (notebookId: string, claimIds?: string[], sourceIds?: string[]) =>
    call<MatrixViewData>("matrix.get", {
      notebookId, ...(claimIds ? { claimIds } : {}), ...(sourceIds ? { sourceIds } : {}),
    }),
  resolveReview: (proposalId: string, decision: "accepted" | "rejected") =>
    call<{}>("review.resolve", { proposalId, decision }),
  listVersions: (sourceId: string) => call<SourceVersionView[]>("sources.listVersions", { sourceId }),
  /** Open one source at a resolved version (latest, or versionId) - the
   *  SourceReader's open path: absolutePath -> asset-protocol URL. Version
   *  scope validation stays engine-side (typed errors arrive German). */
  openSource: (sourceId: string, versionId?: string) =>
    call<SourceOpenView>("sources.open", { sourceId, ...(versionId ? { versionId } : {}) }),
  /** Re-import as a new immutable version; identical bytes return
   *  { unchanged: true }, changed bytes enqueue processing { jobId }. */
  reimportVersion: (sourceId: string, path: string, fileName?: string) =>
    call<{ unchanged: boolean; jobId?: string }>("sources.reimportVersion", {
      sourceId, path, ...(fileName ? { fileName } : {}),
    }),
  /** Deterministic sheet op; typed engine errors carry their code on the
   *  thrown EngineError (localized primary + German detail at the display). */
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
  /** App-managed whisper.cpp runtime (S5): status only here — install stays
   *  a Settings concern; the onboarding checklist only reports the state. */
  whisperRuntimeStatus: () =>
    call<{ installed: boolean; version: string; path: string | null; partialBytes: number }>(
      "runtimes.whisper", { action: "status" }
    ),
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

/** URL a reader/media element can load a stored original from. Tauri window:
 *  the asset protocol (asset:// on macOS/Linux, http://asset.localhost on
 *  Windows). Browser dev: the Next server's /api/files/<storageId> route
 *  serves the SAME LocalStore the engine writes through — the storage id is
 *  the file name under <dataDir>/files minus its extension, UUID-validated
 *  so a non-store path stays quote-only instead of a broken src. */
export function assetUrl(path: string): string | null {
  if (typeof window === "undefined" || !("__TAURI__" in window)) {
    const id = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ? `/api/files/${id}`
      : null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const convert = (window as any).__TAURI__.core?.convertFileSrc as ((p: string) => string) | undefined;
  return typeof convert === "function" ? convert(path) : null;
}

/** Onboarding sample (strategy §9): in the desktop window the Rust command
 *  composes the engine ops (notebook + v1 sample import + claim + v2
 *  re-import) and polls until the sample source has finished processing.
 *  Browser dev has no Rust host — it composes the SAME ops through the HTTP
 *  transport instead, pointed at the redistributable sample PDFs via
 *  window.__NOTELM_DEV_SAMPLES_DIR__ (set by the dev harness / ui-drive;
 *  without it the honest desktop-only error stays). */
export async function createSampleNotebook(): Promise<{
  notebookId: string;
  sourceId: string;
  claimId: string;
}> {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (window as any).__TAURI__.core.invoke("create_sample_notebook");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const samplesDir = (window as any).__NOTELM_DEV_SAMPLES_DIR__;
  if (typeof samplesDir !== "string" || !samplesDir.trim()) {
    throw new Error(t("errors.sampleDesktopOnly"));
  }
  const sample = (name: string) => `${samplesDir.replace(/[\\/]+$/, "")}/${name}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const nb = await desktopApi.createNotebook("Beispiel: Kaffeestudie");
  const { sourceId } = await desktopApi.importFile(
    sample("kaffee-studie-v1.pdf"), nb.id, "kaffee-studie-v1.pdf", "application/pdf"
  );
  // processing is async in the engine scheduler: poll sources.list like the
  // Rust command does (500 ms steps, 30 s cap)
  let v1Done = false;
  for (let i = 0; i < 60 && !v1Done; i++) {
    await sleep(500);
    const s = (await desktopApi.listSources(nb.id)).find((x) => x._id === sourceId);
    if (s?.status === "error") throw new Error(t("errors.sampleProcessing"));
    v1Done = s?.status === "completed";
  }
  if (!v1Done) throw new Error(t("errors.sampleTimeout"));

  const claim = await desktopApi.createClaim(
    nb.id,
    "Die Kaffeestudie 2026 berichtet, Filterkaffee verlängere die durchschnittliche Konzentrationsdauer um 14 Minuten.",
    [{ sourceId, page: 3, quote: "Filterkaffee verlängerte die durchschnittliche Konzentrationsdauer um 14 Minuten." }]
  );
  // v2 as a NEW immutable version of the same source: the staleness scan
  // raises a pending proposal for the changed fact (14 -> 9 minutes)
  const reimported = await desktopApi.reimportVersion(
    sourceId, sample("kaffee-studie-v2.pdf"), "kaffee-studie-v2.pdf"
  );
  if (reimported.jobId) {
    let terminal = false;
    for (let i = 0; i < 60 && !terminal; i++) {
      await sleep(500);
      const j = (await desktopApi.listJobs()).jobs.find((x) => x.id === reimported.jobId);
      if (j?.status === "failed" || j?.status === "cancelled") {
        throw new Error(t("errors.sampleV2Processing"));
      }
      terminal = j?.status === "completed";
    }
    if (!terminal) throw new Error(t("errors.sampleV2Timeout"));
  }
  if ((await desktopApi.listReviews(nb.id)).length === 0) {
    throw new Error(t("errors.sampleNoReviews"));
  }
  return { notebookId: nb.id, sourceId, claimId: claim.id };
}

/** Open a stored evidence file with its platform default app. The Rust side
 *  validates the path against the engine data dir; null in browser dev. */
export async function openExternalFile(path: string): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI__" in window)) {
    throw new Error(t("errors.openExternal"));
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
