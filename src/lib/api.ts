"use client";

/**
 * Typed client for the local API. Wire shapes keep the Convex field name `_id`
 * so existing UI code is unchanged. All calls are same-origin with the local
 * session cookie.
 */

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function send<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

// ── notebooks ──
export const api = {
  listNotebooks: () => get<Notebook[]>(`/api/notebooks`),
  getNotebook: (id: string) => get<Notebook | null>(`/api/notebooks/${id}`),
  createNotebook: (title: string, description?: string) =>
    send<{ id: string }>(`/api/notebooks`, "POST", { title, description }),
  updateNotebook: (id: string, patch: { title?: string; description?: string }) =>
    send<{ ok: boolean }>(`/api/notebooks/${id}`, "PATCH", patch),
  deleteNotebook: (id: string) => send<{ ok: boolean }>(`/api/notebooks/${id}`, "DELETE"),

  // ── sources ──
  listSources: (notebookId: string) => get<Source[]>(`/api/notebooks/${notebookId}/sources`),
  getSource: (id: string) => get<Source>(`/api/sources/${id}`),
  deleteSource: (id: string) => send<{ ok: boolean }>(`/api/sources/${id}`, "DELETE"),
  getChunks: (sourceId: string) => get<Chunk[]>(`/api/sources/${sourceId}/chunks`),

  // ── messages ──
  listMessages: (notebookId: string) => get<Message[]>(`/api/notebooks/${notebookId}/messages`),
  createMessage: (notebookId: string, role: "user" | "assistant", content: string) =>
    send<{ id: string }>(`/api/notebooks/${notebookId}/messages`, "POST", { role, content }),
  clearMessages: (notebookId: string) =>
    send<{ ok: boolean }>(`/api/notebooks/${notebookId}/messages`, "DELETE"),

  // ── notes ──
  listNotes: (notebookId: string) => get<Note[]>(`/api/notebooks/${notebookId}/notes`),
  createNote: (notebookId: string, title: string, content: string) =>
    send<{ id: string }>(`/api/notebooks/${notebookId}/notes`, "POST", { title, content }),
  updateNote: (id: string, patch: { title?: string; content?: string }) =>
    send<{ ok: boolean }>(`/api/notes/${id}`, "PATCH", patch),
  deleteNote: (id: string) => send<{ ok: boolean }>(`/api/notes/${id}`, "DELETE"),

  // ── learning materials ──
  listMaterials: (notebookId: string) => get<Material[]>(`/api/notebooks/${notebookId}/materials`),
  requestMaterial: (notebookId: string, type: string) =>
    send<{ id: string }>(`/api/notebooks/${notebookId}/materials`, "POST", { type }),
  deleteMaterial: (id: string) => send<{ ok: boolean }>(`/api/materials/${id}`, "DELETE"),

  // ── files ──
  fileUrl: (fileId: string) => `/api/files/${fileId}`,
};

export interface Notebook {
  _id: string;
  title: string;
  description?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Source {
  _id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: "pending" | "processing" | "completed" | "error";
  url?: string | null;
  storageId?: string | null;
  errorMessage?: string | null;
}

export interface Chunk {
  _id: string;
  content: string;
  chunkIndex: number;
}

export interface Message {
  _id: string;
  role: "user" | "assistant";
  content: string;
  citations?: { sourceId: string; chunkIndex: number; text: string; fileName?: string }[] | null;
  createdAt: number;
}

export interface Note {
  _id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface Material {
  _id: string;
  type: string;
  status: "pending" | "generating" | "completed" | "error";
  content?: string | null;
  errorMessage?: string | null;
  audioStorageId?: string;
}
