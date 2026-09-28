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

export const desktopApi = {
  listNotebooks: () => call<Notebook[]>("notebooks.list"),
  createNotebook: (title: string) => call<{ id: string }>("notebooks.create", { title }),
  listSources: (notebookId: string) => call<Source[]>("sources.list", { notebookId }),
  importFile: (path: string, notebookId: string, fileName: string, fileType: string) =>
    call<{ sourceId: string }>("sources.importFile", { path, notebookId, fileName, fileType }),
  importUrl: (notebookId: string, url: string) => call<{ jobId: string; deduped: boolean }>("imports.create", { notebookId, url }),
  listMessages: (notebookId: string) => call<Message[]>("messages.list", { notebookId }),
  sendChat: (notebookId: string, message: string) =>
    call<{ response: string; citations: Message["citations"]; mode: string; vectorStatus: string; provider: string }>("chat.send", { notebookId, message }),
  listNotes: (notebookId: string) => call<Note[]>("notes.list", { notebookId }),
  createNote: (notebookId: string, title: string, content: string) =>
    call<{ id: string }>("notes.create", { notebookId, title, content }),
  deleteNote: (noteId: string) => call<{}>("notes.delete", { noteId }),
  activeProfile: () => call<{ profile: { _id: string; model: string; dimension: number } | null }>("retrieval.profile.active"),
  diagnostics: () => call<{ vecVersion: string | null; localChatConfigured: boolean; localEmbedConfigured: boolean }>("diagnostics.capabilities"),
  listModels: () => call<{ models: Array<{ _id: string; capability: "chat" | "embeddings"; fileName: string; sizeBytes: number; sha256: string; status: string; origin: string | null }>; activeChatModelId: string | null; activeEmbedModelId: string | null }>("models.list"),
  importModel: (path: string, capability: "chat" | "embeddings") =>
    call<{ model: { _id: string }; deduped: boolean }>("models.importFile", { path, capability }),
  selectModel: (modelId: string, capability: "chat" | "embeddings") =>
    call<{}>("models.select", { modelId, capability }),
  listMaterials: (notebookId: string) =>
    call<Array<{ _id: string; type: string; status: string; content?: string | null; errorMessage?: string | null }>>("materials.list", { notebookId }),
  requestMaterial: (notebookId: string, type: string) =>
    call<{ id: string }>("materials.request", { notebookId, type }),
  listJobs: () => call<{ jobs: Array<{ kind: "processing" | "import" | "material"; id: string; notebookId: string; title: string; status: string; intent: "run" | "pause" | "cancel"; updatedAt: number }> }>("jobs.list", {}),
  jobAction: (kind: string, jobId: string, action: "pause" | "resume" | "cancel") =>
    call<{ intent: string }>(`jobs.${action}`, { kind, jobId }),
  eventsSince: (cursor: number) =>
    call<{ events: Array<{ seq: number; jobKind: string; jobId: string; type: string; payload: string | null }> }>("jobs.eventsSince", { cursor }),
  exportNotebook: (notebookId: string, targetDir: string) =>
    call<{ documents: number; files: number }>("notebook.export", { notebookId, targetDir }),
  importNotebook: (sourceDir: string) =>
    call<{ notebookId: string; documents: number }>("notebook.import", { sourceDir }),
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
