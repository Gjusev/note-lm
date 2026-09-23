"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import ReactMarkdown from "react-markdown";
import { useSession } from "@/lib/auth-client";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/toaster";
import { UploadDialog } from "@/components/notebook/upload-dialog";

interface SourceData {
  _id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status: string;
  url?: string;
}

interface ChunkData {
  _id: string;
  content: string;
  chunkIndex: number;
}

interface MessageData {
  _id: string;
  role: "user" | "assistant";
  content: string;
  citations?: { sourceId: string; chunkIndex: number; text: string; fileName?: string }[];
}

interface NoteData {
  _id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export default function NotebookPage() {
  const params = useParams();
  const router = useRouter();
  const notebookId = params?.id as string;
  const { data: session } = useSession();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notebook = useQuery(api.notebooks.get, { notebookId } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sources: SourceData[] | undefined = useQuery(api.sources.listByNotebook, { notebookId } as any) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: MessageData[] | undefined = useQuery(api.messages.listByNotebook, { notebookId } as any) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteNotebook = useMutation(api.notebooks.remove) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteSource = useMutation(api.sources.remove) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clearChat = useMutation(api.messages.clearByNotebook) as any;
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const [viewingSource, setViewingSource] = useState<SourceData | null>(null);
  const [viewingChunks, setViewingChunks] = useState<ChunkData[]>([]);
  const [viewingChunksLoading, setViewingChunksLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<"sources" | "notes" | "url" | "search">("sources");
  const [showDelete, setShowDelete] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlLoading, setUrlLoading] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<{ title: string; url: string; snippet?: string }[]>([]);

  // Notes state
  const [editingNote, setEditingNote] = useState<NoteData | null>(null);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [showNewNote, setShowNewNote] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notes: NoteData[] | undefined = useQuery(api.notes.listByNotebook, { notebookId } as any) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createNote = useMutation(api.notes.create) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateNote = useMutation(api.notes.update) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteNote = useMutation(api.notes.remove) as any;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSourceChunks = useCallback(async (source: SourceData) => {
    setViewingSource(source);
    setViewingChunksLoading(true);
    setViewingChunks([]);
    try {
      const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
      const internalKey = process.env.INTERNAL_API_KEY!;
      const res = await fetch(`${convexUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
        body: JSON.stringify({ path: "chunks:getBySource", args: { sourceId: source._id } }),
      });
      const data = await res.json();
      setViewingChunks(data.value || []);
    } catch {
      toast("Chunks konnten nicht geladen werden", "error");
    } finally {
      setViewingChunksLoading(false);
    }
  }, [toast]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMessage = useMutation(api.messages.create) as any;

  const handleChat = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || chatLoading || !session?.user?.id) return;

    const userMessage = message;
    setMessage("");
    setChatLoading(true);

    // Save user message immediately so it appears in the chat
    await createMessage({
      ownerId: session.user.id,
      notebookId,
      role: "user",
      content: userMessage,
    });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          notebookId,
          ownerId: session.user.id,
          skipUserMessage: true,
        }),
      });

      if (!res.ok) throw new Error("Chat fehlgeschlagen");
    } catch {
      toast("Chat-Anfrage fehlgeschlagen", "error");
    } finally {
      setChatLoading(false);
    }
  }, [message, chatLoading, session, notebookId, toast, createMessage]);

  const handleUrlSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || !session?.user?.id) return;

    setUrlLoading(true);
    try {
      const res = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim(), notebookId, ownerId: session.user.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "URL konnte nicht geladen werden", "error");
      } else {
        toast(`"${data.title}" als Quelle hinzugefügt`, "success");
        setUrlInput("");
      }
    } catch {
      toast("URL konnte nicht geladen werden", "error");
    } finally {
      setUrlLoading(false);
    }
  }, [urlInput, session, notebookId, toast]);

  const handleSearch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) return;

    setSearchLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchInput.trim())}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        setSearchResults(data.results);
      } else if (data.error) {
        setSearchResults([]);
        toast(data.error, "error");
      } else {
        setSearchResults([]);
        toast("Keine Ergebnisse gefunden", "info");
      }
    } catch {
      toast("Suche fehlgeschlagen", "error");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [searchInput, toast]);

  const handleAddSearchResult = useCallback(async (result: { title: string; url: string; snippet?: string; content?: string }) => {
    if (!session?.user?.id) return;

    try {
      const res = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: result.url, notebookId, ownerId: session.user.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "Quelle konnte nicht hinzugefügt werden", "error");
      } else {
        toast(`"${result.title}" als Quelle hinzugefügt`, "success");
      }
    } catch {
      toast("Quelle konnte nicht hinzugefügt werden", "error");
    }
  }, [session, notebookId, toast]);

  const handleSaveNote = useCallback(async () => {
    if (!session?.user?.id || !newNoteTitle.trim()) return;
    try {
      if (editingNote) {
        await updateNote({ noteId: editingNote._id, title: newNoteTitle, content: newNoteContent });
        toast("Notiz aktualisiert", "success");
      } else {
        await createNote({ ownerId: session.user.id, notebookId, title: newNoteTitle, content: newNoteContent });
        toast("Notiz erstellt", "success");
      }
      setNewNoteTitle("");
      setNewNoteContent("");
      setEditingNote(null);
      setShowNewNote(false);
    } catch {
      toast("Notiz konnte nicht gespeichert werden", "error");
    }
  }, [session, notebookId, newNoteTitle, newNoteContent, editingNote, createNote, updateNote, toast]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);

  if (!notebook) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-mono-data opacity-50">Laden...</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-52px)] relative">
      {/* ── LEFT: Quellen / Notizen ── */}
      {/* Mobile: slide-over overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 lg:z-auto w-72 border-r-2 border-rule flex flex-col shrink-0 overflow-hidden bg-paper transform transition-transform duration-200 lg:transform-none ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"} top-[52px] lg:top-0 h-[calc(100vh-52px)]`}>
        <div className="border-b border-rule/40 px-4 py-3">
          <Link href="/app" className="text-mono-label opacity-50 hover:opacity-100 transition-opacity">
            ← ZURÜCK
          </Link>
          <h2 className="text-lg font-black uppercase tracking-tight mt-2 truncate">
            {notebook.title}
          </h2>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-4 border-b border-rule/40">
          {(["sources", "url", "search", "notes"] as const).map((tab) => {
            const labels = { sources: "QUELLEN", url: "URL", search: "SUCHE", notes: "NOTIZEN" };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-2 text-mono-label text-center text-[0.6rem] transition-colors ${
                  activeTab === tab
                    ? "border-b-2 border-accent text-accent"
                    : "opacity-50 hover:opacity-80"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "sources" ? (
            <>
              <button
                onClick={() => setUploadOpen(true)}
                className="w-full border-2 border-dashed border-rule/50 p-4 mb-4 text-mono-label hover:border-accent hover:text-accent transition-colors"
              >
                + QUELLE HINZUFÜGEN
              </button>

              {!sources || sources.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-mono-label opacity-40 mb-2">[ LEER ]</p>
                  <p className="text-mono-data opacity-50 text-sm">
                    Lade Quellen hoch, um dein Notizbuch zu befüllen.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {sources.map((s) => (
                    <div
                      key={s._id}
                      className={`border p-3 group relative cursor-pointer transition-colors ${
                        viewingSource?._id === s._id ? "border-accent/60 bg-accent/5" : "border-rule/30 hover:border-accent/30"
                      }`}
                      onClick={() => loadSourceChunks(s)}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-sm font-bold truncate flex-1">{s.fileName}</p>
                        {deletingSourceId === s._id ? (
                          <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={async () => {
                                try {
                                  await deleteSource({ sourceId: s._id });
                                  toast(`"${s.fileName}" gelöscht`, "success");
                                  if (viewingSource?._id === s._id) setViewingSource(null);
                                } catch {
                                  toast("Löschen fehlgeschlagen", "error");
                                }
                                setDeletingSourceId(null);
                              }}
                              className="text-mono-label text-[0.55rem] bg-accent text-white px-1.5 py-0.5 hover:bg-red-700"
                            >
                              JA
                            </button>
                            <button
                              onClick={() => setDeletingSourceId(null)}
                              className="text-mono-label text-[0.55rem] border border-rule/40 px-1.5 py-0.5 hover:bg-paper-muted"
                            >
                              NEIN
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingSourceId(s._id);
                            }}
                            className="text-mono-label opacity-0 group-hover:opacity-40 hover:!opacity-100 hover:!text-accent transition-opacity text-[0.6rem] shrink-0"
                            title="Quelle löschen"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {s.url && (
                        <p className="text-mono-label text-[0.55rem] opacity-40 truncate mt-0.5">{s.url}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-block w-2 h-2 ${
                          s.status === "completed" ? "bg-green-600" :
                          s.status === "processing" ? "bg-yellow-500 animate-pulse" :
                          s.status === "error" ? "bg-accent" : "bg-gray-400"
                        }`} />
                        <p className="text-mono-label text-[0.65rem]">
                          {s.fileType === "text/html" ? "URL" : s.fileType.split("/").pop()?.toUpperCase()} · {(s.fileSize / 1024).toFixed(0)} KB · {s.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : activeTab === "url" ? (
            <>
              <p className="text-mono-label text-accent mb-3">[ URL HINZUFÜGEN ]</p>
              <p className="text-mono-data text-sm mb-4 opacity-70">
                Gib eine URL ein, um den Inhalt als Quelle zu laden.
              </p>
              <form onSubmit={handleUrlSubmit} className="flex flex-col gap-3">
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={urlLoading}
                  className="border-2 border-rule bg-paper px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
                  placeholder="https://example.com/artikel"
                  type="url"
                  required
                />
                <button
                  type="submit"
                  disabled={urlLoading || !urlInput.trim()}
                  className="border-2 border-accent text-accent px-4 py-2 text-mono-label font-bold hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
                >
                  {urlLoading ? "WIRD GELADEN..." : "URL LADEN →"}
                </button>
              </form>
            </>
          ) : activeTab === "search" ? (
            <>
              <p className="text-mono-label text-accent mb-3">[ WEB-SUCHE ]</p>
              <p className="text-mono-data text-sm mb-4 opacity-70">
                Suche nach Informationen und füge Ergebnisse als Quellen hinzu.
              </p>
              <form onSubmit={handleSearch} className="flex flex-col gap-3 mb-4">
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  disabled={searchLoading}
                  className="border-2 border-rule bg-paper px-3 py-2 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
                  placeholder="Suchbegriff eingeben..."
                />
                <button
                  type="submit"
                  disabled={searchLoading || !searchInput.trim()}
                  className="border-2 border-accent text-accent px-4 py-2 text-mono-label font-bold hover:bg-accent hover:text-white transition-colors disabled:opacity-50"
                >
                  {searchLoading ? "SUCHE LÄUFT..." : "SUCHEN →"}
                </button>
              </form>
              {searchResults.length > 0 && (
                <div className="flex flex-col gap-2">
                  {searchResults.map((r, i) => (
                    <div key={i} className="border border-rule/30 p-3">
                      <p className="text-sm font-bold truncate mb-1">{r.title}</p>
                      <p className="text-mono-label text-[0.6rem] opacity-50 truncate mb-2">{r.url}</p>
                      {r.snippet && (
                        <p className="text-xs opacity-70 line-clamp-3 mb-2">{r.snippet}</p>
                      )}
                      <button
                        onClick={() => handleAddSearchResult(r)}
                        className="text-mono-label text-[0.6rem] text-accent hover:underline"
                      >
                        + ALS QUELLE HINZUFÜGEN
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            /* ── NOTES TAB ── */
            <>
              <button
                onClick={() => { setShowNewNote(true); setEditingNote(null); setNewNoteTitle(""); setNewNoteContent(""); }}
                className="w-full border-2 border-dashed border-rule/50 p-3 mb-4 text-mono-label hover:border-accent hover:text-accent transition-colors"
              >
                + NEUE NOTIZ
              </button>

              {showNewNote && (
                <div className="border-2 border-accent/30 p-3 mb-4">
                  <input
                    value={newNoteTitle}
                    onChange={(e) => setNewNoteTitle(e.target.value)}
                    className="w-full border-b border-rule/40 pb-1 mb-2 text-sm font-bold focus:outline-none focus:border-accent bg-transparent"
                    placeholder="Titel..."
                  />
                  <textarea
                    value={newNoteContent}
                    onChange={(e) => setNewNoteContent(e.target.value)}
                    className="w-full text-xs leading-relaxed focus:outline-none resize-none bg-transparent min-h-[80px]"
                    placeholder="Notiz eingeben..."
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleSaveNote}
                      disabled={!newNoteTitle.trim()}
                      className="flex-1 bg-accent text-white text-mono-label text-[0.6rem] py-1.5 hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      {editingNote ? "AKTUALISIEREN" : "SPEICHERN"}
                    </button>
                    <button
                      onClick={() => { setShowNewNote(false); setEditingNote(null); }}
                      className="flex-1 border border-rule/40 text-mono-label text-[0.6rem] py-1.5 hover:bg-paper-muted transition-colors"
                    >
                      ABBRECHEN
                    </button>
                  </div>
                </div>
              )}

              {!notes || notes.length === 0 ? (
                !showNewNote && (
                  <div className="text-center py-4">
                    <p className="text-mono-label opacity-40 mb-2">[ KEINE NOTIZEN ]</p>
                    <p className="text-mono-data opacity-50 text-sm">
                      Erstelle Notizen, um deine Gedanken festzuhalten.
                    </p>
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-2">
                  {notes.map((n) => (
                    <div key={n._id} className="border border-rule/30 p-3 group">
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-sm font-bold truncate flex-1">{n.title}</p>
                        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setEditingNote(n);
                              setNewNoteTitle(n.title);
                              setNewNoteContent(n.content);
                              setShowNewNote(true);
                            }}
                            className="text-mono-label text-[0.55rem] hover:text-accent"
                          >
                            BEARBEITEN
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                await deleteNote({ noteId: n._id });
                                toast("Notiz gelöscht", "success");
                              } catch {
                                toast("Löschen fehlgeschlagen", "error");
                              }
                            }}
                            className="text-mono-label text-[0.55rem] hover:text-accent"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <p className="text-xs opacity-60 line-clamp-3 mt-1 whitespace-pre-wrap">{n.content}</p>
                      <p className="text-mono-label text-[0.5rem] opacity-30 mt-2">
                        {new Date(n.updatedAt).toLocaleDateString("de-DE")}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Delete */}
        <div className="border-t border-rule/40 px-4 py-3">
          {showDelete ? (
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  await deleteNotebook({ notebookId } as any);
                  router.push("/app");
                }}
                className="flex-1 bg-accent text-white text-mono-label py-2 hover:bg-red-700 transition-colors"
              >
                LÖSCHEN
              </button>
              <button
                onClick={() => setShowDelete(false)}
                className="flex-1 border-2 border-rule text-mono-label py-2 hover:bg-paper-muted transition-colors"
              >
                ABBRECHEN
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDelete(true)}
              className="text-mono-label opacity-40 hover:text-accent transition-colors"
            >
              Notizbuch löschen
            </button>
          )}
        </div>
      </aside>

      {/* ── CENTER: Chat ── */}
      <section className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-rule/40 px-3 py-2 md:px-6 md:py-3 flex items-center justify-between shrink-0 gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/app")}
              className="lg:hidden w-8 h-8 flex items-center justify-center border border-rule/30 rounded hover:bg-paper-muted transition-colors"
              aria-label="Zurück"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 2L4 7l5 5" /></svg>
            </button>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden w-8 h-8 flex items-center justify-center border border-rule/30 rounded hover:bg-paper-muted transition-colors"
              aria-label="Seitenleiste"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="1" y1="3" x2="13" y2="3" /><line x1="1" y1="7" x2="13" y2="7" /><line x1="1" y1="11" x2="13" y2="11" /></svg>
            </button>
            <p className="text-mono-label">[ CHAT ]</p>
          </div>
          <div className="flex items-center gap-2">
            {messages && messages.length > 0 && (
              <button
                onClick={async () => { await clearChat({ notebookId }); }}
                className="text-mono-label text-[0.55rem] opacity-30 hover:opacity-70 hover:text-accent transition-all"
                title="Chat löschen"
              >
                LÖSCHEN
              </button>
            )}
            <span className="text-mono-label opacity-30">
              {sources?.length || 0} Quellen
            </span>
            <button
              onClick={() => setMaterialsOpen(!materialsOpen)}
              className="lg:hidden w-8 h-8 flex items-center justify-center border border-rule/30 rounded hover:bg-paper-muted transition-colors"
              aria-label="Lernmaterialien"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="12" height="12" rx="1" /><line x1="4" y1="5" x2="10" y2="5" /><line x1="4" y1="8" x2="8" y2="8" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 md:px-6 md:py-4">
          {/* Source summary bar */}
          {sources && sources.length > 0 && (
            <div className="mb-4 p-3 border border-rule/20 rounded bg-paper-muted/50">
              <p className="text-mono-label text-[0.6rem] text-accent mb-1.5">QUELLEN ÜBERSICHT</p>
              <div className="flex flex-wrap gap-1.5">
                {sources.slice(0, 6).map((s) => (
                  <span key={s._id} className="inline-flex items-center gap-1 text-[0.6rem] px-2 py-0.5 bg-white border border-rule/20 rounded">
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      s.status === "completed" ? "bg-green-500" :
                      s.status === "processing" ? "bg-yellow-500" :
                      s.status === "error" ? "bg-accent" : "bg-gray-300"
                    }`} />
                    <span className="truncate max-w-[100px]">{s.fileName}</span>
                  </span>
                ))}
                {sources.length > 6 && (
                  <span className="text-[0.6rem] px-2 py-0.5 text-gray-400">+{sources.length - 6} weitere</span>
                )}
              </div>
            </div>
          )}

          {!messages || messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center max-w-md px-4">
                <p className="text-mono-label text-accent mb-3">[ BEREIT ]</p>
                <p className="text-mono-data mb-4">
                  Stelle eine Frage an deine hochgeladenen Quellen.
                </p>
                {sources && sources.filter((s) => s.status === "completed").length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-mono-label text-[0.6rem] opacity-40 mb-1">VORSCHLÄGE</p>
                    <SuggestedQuestions
                      sources={sources.filter((s) => s.status === "completed")}
                      onSelect={(q) => { setMessage(q); }}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {messages.map((msg) => (
                <div
                  key={msg._id}
                  className={`max-w-[85%] ${
                    msg.role === "user"
                      ? "self-end border-2 border-rule bg-paper-muted"
                      : "self-start border-l-4 border-accent bg-white/50"
                  } p-4`}
                >
                  {msg.role === "assistant" ? (
                    <div className="text-sm leading-relaxed prose prose-sm max-w-none prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tight prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  )}
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-rule/20 flex flex-wrap gap-1.5">
                      {msg.citations.map((c, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-[0.6rem] font-mono bg-accent/5 text-accent border border-accent/15 px-2 py-0.5 rounded-full">
                          <span className="w-1 h-1 bg-accent rounded-full" />
                          {(() => {
                            const src = sources?.find((s) => s._id === c.sourceId);
                            const name = src?.fileName || c.fileName || "Quelle " + (i + 1);
                            return <span className="truncate max-w-[140px]">{name}</span>;
                          })()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div className="self-start max-w-[85%] border-l-4 border-accent bg-white/50 p-4">
                  <div className="flex items-center gap-1.5">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-accent/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-accent/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-accent/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <p className="text-mono-label text-[0.6rem] opacity-40 ml-2">KI denkt nach...</p>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-rule/40 px-3 py-3 md:px-6 md:py-4 shrink-0">
          <form onSubmit={handleChat} className="flex gap-2 md:gap-3">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={chatLoading}
              className="flex-1 border-2 border-rule bg-paper px-3 py-2.5 md:px-4 md:py-3 text-sm focus:outline-none focus:border-accent disabled:opacity-50"
              placeholder="Frage an deine Quellen stellen..."
            />
            <button
              type="submit"
              disabled={chatLoading || !message.trim()}
              className="bg-accent text-white border-2 border-accent px-4 py-2.5 md:px-6 md:py-3 text-mono-label font-bold hover:bg-ink hover:border-ink transition-colors disabled:opacity-50"
            >
              {chatLoading ? "..." : "→"}
            </button>
          </form>
        </div>
      </section>

      {/* ── RIGHT: Source Detail / Learning Materials ── */}
      <aside className="w-80 border-l-2 border-rule flex flex-col shrink-0 overflow-hidden hidden lg:flex">
        {viewingSource ? (
          <>
            <div className="border-b border-rule/40 px-4 py-3 flex items-center justify-between shrink-0">
              <div className="min-w-0">
                <p className="text-mono-label text-accent text-[0.6rem]">[ QUELLE ]</p>
                <p className="text-sm font-bold truncate">{viewingSource.fileName}</p>
              </div>
              <button
                onClick={() => setViewingSource(null)}
                className="text-mono-label opacity-50 hover:opacity-100 shrink-0 ml-2"
              >
                SCHLIEẞEN ✕
              </button>
            </div>
            <div className="px-4 py-3 border-b border-rule/20 space-y-2 shrink-0">
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 ${
                  viewingSource.status === "completed" ? "bg-green-600" :
                  viewingSource.status === "processing" ? "bg-yellow-500 animate-pulse" :
                  viewingSource.status === "error" ? "bg-accent" : "bg-gray-400"
                }`} />
                <span className="text-mono-label text-[0.65rem]">{viewingSource.status}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-mono-label text-[0.6rem] opacity-60">
                <span>TYP</span><span>{viewingSource.fileType === "text/html" ? "URL" : viewingSource.fileType.split("/").pop()?.toUpperCase()}</span>
                <span>GRÖSSE</span><span>{(viewingSource.fileSize / 1024).toFixed(0)} KB</span>
                {viewingSource.url && <><span>URL</span><span className="truncate">{viewingSource.url}</span></>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <p className="text-mono-label text-[0.6rem] opacity-40 mb-3">
                [ CHUNKS: {viewingChunks.length} ]
              </p>
              {viewingChunksLoading ? (
                <p className="text-mono-data opacity-50 text-center">Laden...</p>
              ) : viewingChunks.length === 0 ? (
                <p className="text-mono-data opacity-50 text-center">Keine Chunks vorhanden.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {viewingChunks.map((c) => (
                    <div key={c._id} className="border border-rule/20 p-3">
                      <p className="text-mono-label text-[0.55rem] opacity-40 mb-1">CHUNK {c.chunkIndex}</p>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap">{c.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="border-b border-rule/40 px-4 py-3 flex items-center justify-between">
              <p className="text-mono-label font-bold">LERNMATERIALIEN</p>
              <MaterialCountBadge notebookId={notebookId} />
            </div>
            <LearningMaterialsPanel notebookId={notebookId} ownerId={session?.user?.id || ""} />
          </>
        )}
      </aside>

      {/* ── MOBILE: Learning Materials Bottom Sheet ── */}
      {materialsOpen && (
        <>
          <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setMaterialsOpen(false)} />
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t-2 border-rule rounded-t-xl max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-rule/40 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-10 h-1 bg-gray-300 rounded-full" />
                <p className="text-mono-label font-bold">LERNMATERIALIEN</p>
              </div>
              <button
                onClick={() => setMaterialsOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-400"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <LearningMaterialsPanel notebookId={notebookId} ownerId={session?.user?.id || ""} />
            </div>
          </div>
        </>
      )}

      {/* Upload dialog */}
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        notebookId={notebookId}
        ownerId={session?.user?.id || ""}
      />
    </div>
  );
}

// ── Material Types ──

const MATERIAL_TYPES = [
  { type: "summary" as const, label: "Zusammenfassung", icon: "doc" },
  { type: "flashcards" as const, label: "Karteikarten", icon: "cards" },
  { type: "quiz" as const, label: "Quiz", icon: "check" },
  { type: "studyGuide" as const, label: "Lernleitfaden", icon: "book" },
  { type: "keyInsights" as const, label: "Kernerkenntnisse", icon: "light" },
  { type: "podcastSummary" as const, label: "Podcast", icon: "mic" },
  { type: "slides" as const, label: "Präsentation", icon: "slides" },
];

function SuggestedQuestions({ sources, onSelect }: { sources: SourceData[]; onSelect: (q: string) => void }) {
  const questions: string[] = [];
  const fileNames = sources.map((s) => s.fileName.toLowerCase());

  if (fileNames.some((n) => n.endsWith(".pdf") || n.includes("paper") || n.includes("arbeit")))
    questions.push("Was sind die wichtigsten Erkenntnisse aus meinen Dokumenten?");
  if (fileNames.some((n) => n.includes("audio") || n.includes("mp3") || n.includes("wav") || n.includes("video")))
    questions.push("Kannst du eine kurze Zusammenfassung der Audios/Transkripte geben?");
  questions.push("Was haben meine Quellen gemeinsam?");
  questions.push("Welche offenen Fragen bleiben nach Analyse der Quellen?");
  if (sources.length >= 2)
    questions.push("Gibt es Widersprüche zwischen den verschiedenen Quellen?");

  const shown = questions.slice(0, 4);

  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((q) => (
        <button
          key={q}
          onClick={() => onSelect(q)}
          className="text-left text-xs text-ink/70 border border-gray-200 rounded-lg px-3 py-2 hover:border-accent hover:text-accent transition-colors"
        >
          → {q}
        </button>
      ))}
    </div>
  );
}

function MaterialIcon({ icon, className }: { icon: string; className?: string }) {
  const base = className || "w-4 h-4";
  switch (icon) {
    case "doc": return <svg className={base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="1" width="12" height="14" rx="1" /><line x1="5" y1="5" x2="11" y2="5" /><line x1="5" y1="8" x2="11" y2="8" /><line x1="5" y1="11" x2="9" y2="11" /></svg>;
    case "cards": return <svg className={base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="3" width="6" height="10" rx="1" /><rect x="9" y="3" width="6" height="10" rx="1" /><line x1="3" y1="6" x2="5" y2="6" /><line x1="11" y1="6" x2="13" y2="6" /></svg>;
    case "check": return <svg className={base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="7" /><path d="M5 8l2 2 4-4" /></svg>;
    case "book": return <svg className={base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 2h5a2 2 0 012 2v10a1.5 1.5 0 00-1.5-1.5H2V2z" /><path d="M14 2H9a2 2 0 00-2 2v10a1.5 1.5 0 011.5-1.5H14V2z" /></svg>;
    case "light": return <svg className={base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1v2M13 4l-1.5 1.5M14 9h-2M3 9H1M4.5 5.5L3 4M12 9a4 4 0 11-8 0" /><path d="M6 13h4v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-1z" /></svg>;
    case "mic": return <svg className={base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5.5" y="1" width="5" height="8" rx="2.5" /><path d="M3 7a5 5 0 0010 0M8 12v3M6 15h4" /></svg>;
    case "slides": return <svg className={base} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="2" width="14" height="10" rx="1" /><line x1="5" y1="14" x2="11" y2="14" /><line x1="8" y1="12" x2="8" y2="14" /></svg>;
    default: return null;
  }
}

// ── Count Badge ──

function MaterialCountBadge({ notebookId }: { notebookId: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const materials: MaterialData[] | undefined = useQuery(api.learningMaterials.listByNotebook, { notebookId } as any) as any;
  if (!materials) return null;
  const done = materials.filter((m) => m.status === "completed").length;
  return <span className="text-[0.65rem] text-gray-400 font-mono">{done}/{MATERIAL_TYPES.length}</span>;
}

// ── Data types ──

interface MaterialData {
  _id: string;
  type: string;
  status: string;
  content?: string;
  errorMessage?: string;
  audioStorageId?: string;
}

// ── Panel ──

function LearningMaterialsPanel({ notebookId, ownerId }: { notebookId: string; ownerId: string }) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
  const internalKey = process.env.INTERNAL_API_KEY!;
  const { toast } = useToast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const materials: MaterialData[] | undefined = useQuery(api.learningMaterials.listByNotebook, { notebookId } as any) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteMaterial = useMutation(api.learningMaterials.remove) as any;
  const [generating, setGenerating] = useState<string | null>(null);
  const [viewing, setViewing] = useState<MaterialData | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Group materials by type
  const versionsMap = new Map<string, MaterialData[]>();
  const activeSet = new Set<string>();

  (materials || []).forEach((m) => {
    const existing = versionsMap.get(m.type) || [];
    versionsMap.set(m.type, [...existing, m]);
    if (m.status === "pending" || m.status === "generating") activeSet.add(m.type);
  });

  const getCompletedVersions = (type: string) => {
    const versions = versionsMap.get(type) || [];
    return versions.filter((m) => m.status === "completed");
  };

  async function handleGenerate(type: string) {
    if (!ownerId) return;
    setGenerating(type);
    try {
      const res = await fetch(`${convexUrl}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
        body: JSON.stringify({
          path: "learningMaterials:requestGeneration",
          args: { ownerId, notebookId, type },
        }),
      });
      const { value: materialId } = await res.json();

      const genRes = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, notebookId, type }),
      });

      if (genRes.ok) {
        toast(`${MATERIAL_TYPES.find((m) => m.type === type)?.label} erstellt`, "success");
      } else {
        toast("Generierung fehlgeschlagen", "error");
      }
    } catch {
      toast("Generierung fehlgeschlagen", "error");
    } finally {
      setGenerating(null);
    }
  }

  async function handleDelete(materialId: string) {
    try {
      await deleteMaterial({ materialId });
      toast("Material gelöscht", "success");
    } catch {
      toast("Löschen fehlgeschlagen", "error");
    }
    setConfirmDelete(null);
  }

  async function handleAddAsSource(material: MaterialData) {
    if (!material.content || !ownerId) return;
    try {
      const label = MATERIAL_TYPES.find((m) => m.type === material.type)?.label || material.type;
      const res = await fetch("/api/fetch-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId,
          ownerId,
          title: `${label} (Lernmaterial)`,
          forceText: material.content,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast(`"${label}" als Quelle hinzugefügt`, "success");
      } else {
        toast(data.error || "Quelle konnte nicht hinzugefügt werden", "error");
      }
    } catch {
      toast("Quelle konnte nicht hinzugefügt werden", "error");
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 flex flex-col gap-1.5">
          {MATERIAL_TYPES.map(({ type, label, icon }) => {
            const versions = getCompletedVersions(type);
            const allVersions = versionsMap.get(type) || [];
            const isActive = activeSet.has(type) || generating === type;

            return (
              <div
                key={type}
                className={`group border rounded-lg p-3 transition-colors ${
                  versions.length > 0
                    ? "border-green-200/70 bg-green-50/30"
                    : isActive
                    ? "border-yellow-200 bg-yellow-50/30"
                    : "border-gray-100 hover:border-gray-200"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className={`shrink-0 ${versions.length > 0 ? "text-green-600" : isActive ? "text-yellow-500" : "text-gray-400"}`}>
                    <MaterialIcon icon={icon} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{label}</p>
                      {allVersions.length > 1 && (
                        <span className="text-[0.6rem] font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                          {allVersions.length}x
                        </span>
                      )}
                    </div>
                    {isActive && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full animate-pulse" />
                        <p className="text-[0.6rem] text-yellow-600 font-medium">Wird erstellt...</p>
                      </div>
                    )}
                  </div>
                  {versions.length > 0 && (
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full shrink-0" />
                  )}
                </div>

                {/* Actions */}
                <div className="mt-2 flex gap-1.5">
                  {versions.length > 0 ? (
                    <>
                      <button
                        onClick={() => setViewing(versions[versions.length - 1])}
                        className="flex-1 text-[0.65rem] font-bold text-accent py-1.5 border border-accent/20 rounded hover:bg-accent hover:text-white transition-colors text-center"
                      >
                        ANZEIGEN →
                      </button>
                      <button
                        onClick={() => handleGenerate(type)}
                        disabled={generating !== null}
                        className="text-[0.65rem] text-gray-400 py-1.5 px-2 border border-gray-200 rounded hover:text-accent hover:border-accent/30 transition-colors disabled:opacity-30"
                        title="Neue Version generieren"
                      >
                        + NEU
                      </button>
                    </>
                  ) : isActive ? (
                    <div className="flex-1 flex items-center gap-1.5">
                      <div className="flex-1">
                        <div className="h-1.5 bg-yellow-200 rounded-full overflow-hidden">
                          <div className="h-full bg-yellow-500 rounded-full animate-pulse w-2/3" />
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const stuck = (versionsMap.get(type) || []).find((m) => m.status === "pending" || m.status === "generating");
                          if (stuck) handleDelete(stuck._id);
                        }}
                        className="text-[0.6rem] text-yellow-500 py-1 px-1.5 border border-yellow-300 rounded hover:text-red-500 hover:border-red-300 transition-colors shrink-0"
                        title="Abbrechen"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleGenerate(type)}
                      disabled={generating !== null}
                      className="w-full text-[0.65rem] font-bold text-accent py-1.5 border border-accent/20 rounded hover:bg-accent hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      GENERIEREN
                    </button>
                  )}
                </div>

                {/* All versions with delete */}
                {allVersions.length > 1 && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <div className="flex flex-wrap gap-1">
                      {allVersions.map((v, i) => (
                        <div key={v._id} className="relative group/ver">
                          {v.status === "completed" ? (
                            <button
                              onClick={() => setViewing(v)}
                              className="text-[0.6rem] font-mono px-2 py-0.5 border border-gray-200 rounded hover:bg-accent hover:text-white hover:border-accent transition-colors pr-6"
                            >
                              v{i + 1}
                              <span
                                onClick={(e) => { e.stopPropagation(); setConfirmDelete(v._id); }}
                                className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-400 text-white text-[0.45rem] rounded-full flex items-center justify-center opacity-0 group-hover/ver:opacity-100 transition-opacity cursor-pointer"
                              >
                                ✕
                              </span>
                            </button>
                          ) : v.status === "error" ? (
                            <span className="text-[0.6rem] font-mono px-2 py-0.5 border border-red-200 rounded text-red-400 bg-red-50">
                              ✕
                            </span>
                          ) : (
                            <button
                              onClick={() => handleDelete(v._id)}
                              className="text-[0.6rem] font-mono px-2 py-0.5 border border-yellow-300 rounded text-yellow-600 bg-yellow-50 hover:bg-red-50 hover:text-red-500 hover:border-red-300 transition-colors"
                              title="Generierung abbrechen"
                            >
                              ⏳ ✕
                            </button>
                          )}
                          {confirmDelete === v._id && (
                            <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg p-1.5 flex gap-1 z-10">
                              <button
                                onClick={() => handleDelete(v._id)}
                                className="text-[0.5rem] bg-accent text-white px-1.5 py-0.5 rounded hover:bg-red-700"
                              >
                                JA
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="text-[0.5rem] border border-gray-200 px-1.5 py-0.5 rounded hover:bg-gray-50"
                              >
                                NEIN
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Delete single version */}
                {allVersions.length === 1 && versions.length === 1 && (
                  <div className="mt-1.5 flex justify-end">
                    <button
                      onClick={() => setConfirmDelete(allVersions[0]._id)}
                      className="text-[0.55rem] text-gray-300 hover:text-accent transition-colors"
                    >
                      LÖSCHEN
                    </button>
                    {confirmDelete === allVersions[0]._id && (
                      <div className="ml-1 flex gap-1">
                        <button onClick={() => handleDelete(allVersions[0]._id)} className="text-[0.5rem] bg-accent text-white px-1.5 py-0.5 rounded">JA</button>
                        <button onClick={() => setConfirmDelete(null)} className="text-[0.5rem] border border-gray-200 px-1.5 py-0.5 rounded">NEIN</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Content Viewer Modal ── */}
      {viewing && (
        <MaterialViewer
          material={viewing}
          onClose={() => setViewing(null)}
          onDelete={async () => { await handleDelete(viewing._id); setViewing(null); }}
          onAddAsSource={() => handleAddAsSource(viewing)}
        />
      )}
    </>
  );
}

// ── Material Viewer Modal ──

function MaterialViewer({ material, onClose, onDelete, onAddAsSource }: { material: MaterialData; onClose: () => void; onDelete: () => void; onAddAsSource: () => void }) {
  const label = MATERIAL_TYPES.find((m) => m.type === material.type)?.label || material.type;
  const icon = MATERIAL_TYPES.find((m) => m.type === material.type)?.icon || "doc";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | undefined>();

  useEffect(() => {
    if (material.audioStorageId) {
      const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
      const internalKey = process.env.INTERNAL_API_KEY!;
      fetch(`${convexUrl}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-key": internalKey },
        body: JSON.stringify({ path: "sources:getDownloadUrl", args: { storageId: material.audioStorageId } }),
      })
        .then((r) => r.json())
        .then((data) => { if (data.value) setAudioUrl(data.value); })
        .catch(() => {});
    }
  }, [material.audioStorageId]);

  function handleExport(format: "md" | "json" | "txt") {
    const content = material.content || "";
    let blob: Blob;
    let filename: string;

    if (format === "json") {
      blob = new Blob([content], { type: "application/json" });
      filename = `${label.toLowerCase().replace(/\s+/g, "-")}.json`;
    } else if (format === "txt") {
      blob = new Blob([content], { type: "text/plain" });
      filename = `${label.toLowerCase().replace(/\s+/g, "-")}.txt`;
    } else {
      blob = new Blob([`# ${label}\n\n${content}`], { type: "text/markdown" });
      filename = `${label.toLowerCase().replace(/\s+/g, "-")}.md`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white border border-gray-200 rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <MaterialIcon icon={icon} className="w-5 h-5 text-accent shrink-0" />
              <p className="text-sm font-bold truncate">{label}</p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600 text-base shrink-0"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {/* Export dropdown */}
            <div className="relative group/exp">
              <button
                className="text-[0.6rem] font-bold text-gray-500 py-1 px-2 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
                onClick={(e) => { e.stopPropagation(); }}
              >
                EXPORT ↓
              </button>
              <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg py-1 min-w-[80px] opacity-0 invisible group-hover/exp:opacity-100 group-hover/exp:visible transition-all z-10">
                <button onClick={() => handleExport("md")} className="w-full text-left text-xs px-2 py-1 hover:bg-gray-50">.md</button>
                <button onClick={() => handleExport("txt")} className="w-full text-left text-xs px-2 py-1 hover:bg-gray-50">.txt</button>
                <button onClick={() => handleExport("json")} className="w-full text-left text-xs px-2 py-1 hover:bg-gray-50">.json</button>
              </div>
            </div>
            <button
              onClick={onAddAsSource}
              className="text-[0.6rem] font-bold text-accent py-1 px-2 border border-accent/20 rounded hover:bg-accent hover:text-white transition-colors"
            >
              + QUELLE
            </button>
            {audioUrl && (
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(audioUrl);
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `podcast.mp3`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch { /* ignore */ }
                }}
                className="text-[0.6rem] font-bold text-gray-500 py-1 px-2 border border-gray-200 rounded hover:bg-gray-50 hover:text-gray-700 transition-colors"
              >
                ↓ AUDIO
              </button>
            )}
            {confirmDelete ? (
              <div className="flex gap-1">
                <button onClick={onDelete} className="text-[0.6rem] bg-accent text-white px-2 py-1 rounded hover:bg-red-700">JA</button>
                <button onClick={() => setConfirmDelete(false)} className="text-[0.6rem] border border-gray-200 px-2 py-1 rounded hover:bg-gray-50">NEIN</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-[0.6rem] text-gray-400 py-1 px-2 border border-gray-200 rounded hover:text-accent hover:border-accent/30 transition-colors"
              >
                LÖSCHEN
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <MaterialContent type={material.type} content={material.content || ""} audioUrl={audioUrl} />
        </div>
      </div>
    </div>
  );
}

// ── Content Router ──

function MaterialContent({ type, content, audioUrl }: { type: string; content: string; audioUrl?: string }) {
  if (type === "flashcards") return <FlashcardViewer content={content} />;
  if (type === "quiz") return <QuizViewer content={content} />;
  if (type === "slides") return <SlidesViewer content={content} />;
  if (type === "podcastSummary") return <PodcastViewer content={content} audioUrl={audioUrl} />;
  return <MarkdownViewer content={content} />;
}

// ── Flashcards ──

interface Flashcard { front: string; back: string }

function FlashcardViewer({ content }: { content: string }) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    try {
      const parsed = JSON.parse(extractJSON(content));
      if (Array.isArray(parsed)) {
        setCards(parsed.filter((c: Flashcard) => c.front && c.back));
      }
    } catch {
      setCards([{ front: "Inhalt konnte nicht geparst werden", back: content }]);
    }
  }, [content]);

  if (cards.length === 0) return <div className="p-6 text-sm text-gray-500">Keine Karteikarten gefunden.</div>;

  const card = cards[current];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-mono-label text-gray-400">Karte {current + 1} / {cards.length}</p>
        <div className="flex gap-1">
          {cards.map((_, i) => (
            <button
              key={i}
              onClick={() => { setCurrent(i); setFlipped(false); }}
              className={`w-2 h-2 rounded-full transition-colors ${i === current ? "bg-accent" : "bg-gray-200"}`}
            />
          ))}
        </div>
      </div>

      <div
        onClick={() => setFlipped(!flipped)}
        className="min-h-[220px] border-2 rounded-xl p-8 cursor-pointer transition-all flex items-center justify-center select-none"
        style={{
          borderColor: flipped ? "#DC2626" : "#e5e5e5",
          backgroundColor: flipped ? "#FEF2F2" : "white",
        }}
      >
        <div className="text-center max-w-md">
          <p className={`text-xs font-bold mb-3 ${flipped ? "text-accent" : "text-gray-400"}`}>
            {flipped ? "ANTWORT" : "FRAGE"} — Klicken zum Umdrehen
          </p>
          <p className={`text-lg leading-relaxed ${flipped ? "font-normal" : "font-semibold"}`}>
            {flipped ? card.back : card.front}
          </p>
        </div>
      </div>

      <div className="flex justify-between mt-4">
        <button
          onClick={() => { setCurrent(Math.max(0, current - 1)); setFlipped(false); }}
          disabled={current === 0}
          className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
        >
          ← Zurück
        </button>
        <button
          onClick={() => { setCurrent(Math.min(cards.length - 1, current + 1)); setFlipped(false); }}
          disabled={current === cards.length - 1}
          className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
        >
          Weiter →
        </button>
      </div>
    </div>
  );
}

// ── Quiz ──

interface QuizQuestion { question: string; options: string[]; correct: number; explanation: string }

function QuizViewer({ content }: { content: string }) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState<Record<number, number>>({});

  useEffect(() => {
    try {
      const parsed = JSON.parse(extractJSON(content));
      if (Array.isArray(parsed)) setQuestions(parsed);
    } catch {
      setQuestions([{ question: "Fehler beim Parsen", options: [content], correct: 0, explanation: "" }]);
    }
  }, [content]);

  if (questions.length === 0) return <div className="p-6 text-sm text-gray-500">Kein Quiz gefunden.</div>;

  const q = questions[current];
  const isAnswered = selected !== null;
  const isCorrect = selected === q.correct;
  const totalCorrect = Object.entries(answered).filter(([idx, a]) => a === questions[Number(idx)]?.correct).length;
  const totalAnswered = Object.keys(answered).length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-mono-label text-gray-400">Frage {current + 1} / {questions.length}</p>
        {totalAnswered > 0 && (
          <p className="text-mono-label text-accent">{totalCorrect}/{totalAnswered} richtig</p>
        )}
      </div>

      <p className="text-base font-semibold mb-4">{q.question}</p>

      <div className="flex flex-col gap-2">
        {q.options.map((opt, i) => {
          let cls = "border border-gray-200 p-3 rounded-lg text-sm cursor-pointer transition-all hover:bg-gray-50 hover:border-gray-300";
          if (isAnswered) {
            if (i === q.correct) cls = "border-2 border-green-500 bg-green-50 p-3 rounded-lg text-sm";
            else if (i === selected && !isCorrect) cls = "border-2 border-red-400 bg-red-50 p-3 rounded-lg text-sm opacity-70";
            else cls = "border border-gray-100 p-3 rounded-lg text-sm opacity-40";
          }

          return (
            <button
              key={i}
              onClick={() => {
                if (isAnswered) return;
                setSelected(i);
                setAnswered({ ...answered, [current]: i });
              }}
              className={cls}
            >
              <span className="font-mono text-xs text-gray-400 mr-2">{String.fromCharCode(65 + i)}</span>
              {opt}
            </button>
          );
        })}
      </div>

      {isAnswered && q.explanation && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${isCorrect ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
          <p className="font-bold mb-1">{isCorrect ? "Richtig!" : "Falsch"}</p>
          <p>{q.explanation}</p>
        </div>
      )}

      <div className="flex justify-between mt-4">
        <button
          onClick={() => { setCurrent(Math.max(0, current - 1)); setSelected(answered[current - 1] ?? null); }}
          disabled={current === 0}
          className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
        >
          ← Zurück
        </button>
        <button
          onClick={() => { setCurrent(Math.min(questions.length - 1, current + 1)); setSelected(answered[current + 1] ?? null); }}
          disabled={current === questions.length - 1}
          className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
        >
          Weiter →
        </button>
      </div>
    </div>
  );
}

// ── Slides ──

interface Slide { title: string; content: string }

function SlidesViewer({ content }: { content: string }) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    try {
      const parsed = JSON.parse(extractJSON(content));
      if (Array.isArray(parsed)) setSlides(parsed);
    } catch {
      setSlides([{ title: "Inhalt", content }]);
    }
  }, [content]);

  if (slides.length === 0) return <div className="p-6 text-sm text-gray-500">Keine Präsentation gefunden.</div>;

  const slide = slides[current];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-mono-label text-gray-400">Folie {current + 1} / {slides.length}</p>
        <div className="flex gap-0.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`h-1.5 rounded-full transition-colors ${i === current ? "bg-accent w-6" : "bg-gray-200 w-3"}`}
            />
          ))}
        </div>
      </div>

      <div className="border border-gray-200 rounded-xl p-8 min-h-[250px] bg-white">
        <p className="text-xl font-bold mb-4">{slide.title}</p>
        <div className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700">{slide.content}</div>
      </div>

      <div className="flex justify-between mt-4">
        <button
          onClick={() => setCurrent(Math.max(0, current - 1))}
          disabled={current === 0}
          className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
        >
          ← Zurück
        </button>
        <button
          onClick={() => setCurrent(Math.min(slides.length - 1, current + 1))}
          disabled={current === slides.length - 1}
          className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-30 transition-colors"
        >
          Weiter →
        </button>
      </div>
    </div>
  );
}

// ── Podcast ──

function PodcastViewer({ content, audioUrl }: { content: string; audioUrl?: string }) {
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [seeking, setSeeking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const formatTime = (s: number) => {
    if (!isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const ensureAudio = () => {
    if (!audioRef.current && audioUrl) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onended = () => setAudioPlaying(false);
      audioRef.current.ondurationchange = () => setDuration(audioRef.current?.duration || 0);
      audioRef.current.ontimeupdate = () => { if (!seeking) setCurrentTime(audioRef.current?.currentTime || 0); };
      audioRef.current.playbackRate = playbackRate;
    }
    return audioRef.current!;
  };

  const togglePlay = () => {
    const a = ensureAudio();
    if (audioPlaying) { a.pause(); setAudioPlaying(false); }
    else { a.play(); setAudioPlaying(true); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = ensureAudio();
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * duration;
    setCurrentTime(pct * duration);
  };

  const skip = (seconds: number) => {
    const a = ensureAudio();
    a.currentTime = Math.max(0, Math.min(duration, a.currentTime + seconds));
    setCurrentTime(a.currentTime);
  };

  const changeSpeed = () => {
    const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
    const idx = speeds.indexOf(playbackRate);
    const next = speeds[(idx + 1) % speeds.length];
    setPlaybackRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const lines = content.split("\n");

  // Pause audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <div className="p-6">
      {audioUrl && (
        <div className="mb-5 p-4 bg-gray-50 border border-gray-200 rounded-lg" onClick={(e) => e.stopPropagation()}>
          {/* Title */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[0.6rem] font-mono text-accent font-bold tracking-wider">[ PODCAST ]</span>
            <span className="text-[0.55rem] text-gray-400">KI-generierte Audio-Version</span>
          </div>

          {/* Progress bar */}
          <div
            ref={progressRef}
            onClick={seek}
            onMouseDown={() => setSeeking(true)}
            onMouseUp={() => setSeeking(false)}
            className="w-full h-2 bg-gray-200 rounded-full cursor-pointer mb-2 group relative"
          >
            <div
              className="h-full bg-accent rounded-full transition-[width] duration-100"
              style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white border-2 border-accent rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: duration ? `calc(${(currentTime / duration) * 100}% - 7px)` : "-7px" }}
            />
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2">
            {/* Time */}
            <span className="text-[0.6rem] font-mono text-gray-500 w-16 shrink-0">{formatTime(currentTime)} / {formatTime(duration)}</span>

            {/* Skip back */}
            <button onClick={() => skip(-10)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors text-gray-500 text-xs" title="10s zurück">
              ⟲
            </button>

            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className={`w-9 h-9 rounded-full flex items-center justify-center text-white shrink-0 transition-colors text-sm ${audioPlaying ? "bg-accent" : "bg-gray-800 hover:bg-gray-700"}`}
            >
              {audioPlaying ? "❚❚" : "▶"}
            </button>

            {/* Skip forward */}
            <button onClick={() => skip(10)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors text-gray-500 text-xs" title="10s vor">
              ⟳
            </button>

            {/* Speed */}
            <button
              onClick={changeSpeed}
              className="text-[0.6rem] font-mono font-bold px-2 py-1 border border-gray-300 rounded hover:bg-gray-200 transition-colors text-gray-600"
              title="Wiedergabegeschwindigkeit"
            >
              {playbackRate}x
            </button>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Download */}
            <button
              onClick={async () => {
                try {
                  const res = await fetch(audioUrl);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "podcast.mp3";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch { /* ignore */ }
              }}
              className="text-[0.6rem] font-mono font-bold px-2 py-1 border border-gray-300 rounded hover:bg-gray-200 transition-colors text-gray-500"
              title="Audio herunterladen"
            >
              ↓ MP3
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {lines.map((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={i} className="h-2" />;

          const headingMatch = trimmed.match(/^(#{1,3})\s*(.+)/);
          if (headingMatch) {
            const speaker = headingMatch[2];
            const isHost1 = /moderator\s*1|moderatorin\s*1/i.test(speaker);
            return (
              <div key={i} className="flex items-center gap-2.5 mt-5 first:mt-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${isHost1 ? "bg-accent" : "bg-gray-800"}`}>
                  {isHost1 ? "M1" : "M2"}
                </div>
                <p className="text-sm font-bold">{renderInline(speaker)}</p>
              </div>
            );
          }

          if (/^moderator(?:in)?\s*[12]/i.test(trimmed)) {
            const isHost1 = /moderator(?:in)?\s*1/i.test(trimmed);
            return (
              <div key={i} className="flex items-center gap-2.5 mt-5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${isHost1 ? "bg-accent" : "bg-gray-800"}`}>
                  {isHost1 ? "M1" : "M2"}
                </div>
                <p className="text-sm font-bold">{renderInline(trimmed)}</p>
              </div>
            );
          }

          return (
            <p key={i} className="text-sm leading-relaxed pl-11 text-gray-600">{renderInline(trimmed)}</p>
          );
        })}
      </div>
    </div>
  );
}

// ── Markdown viewer (summary, studyGuide, keyInsights) ──

function MarkdownViewer({ content }: { content: string }) {
  return (
    <div className="p-6 prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900 prose-code:text-accent prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-blockquote:border-l-accent prose-blockquote:bg-gray-50 prose-blockquote:py-2 prose-blockquote:px-4 prose-hr:border-gray-200">
      <RenderMarkdown text={content} />
    </div>
  );
}

function RenderMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "h1": return <h1 key={i} className="text-xl font-bold mt-6 mb-3 first:mt-0">{renderInline(block.content)}</h1>;
          case "h2": return <h2 key={i} className="text-lg font-bold mt-5 mb-2">{renderInline(block.content)}</h2>;
          case "h3": return <h3 key={i} className="text-base font-bold mt-4 mb-2 text-accent">{renderInline(block.content)}</h3>;
          case "h4": return <h4 key={i} className="text-sm font-bold mt-3 mb-1">{renderInline(block.content)}</h4>;
          case "quote": return <blockquote key={i} className="border-l-4 border-accent/40 bg-gray-50 py-2 px-4 my-3 text-sm text-gray-600 italic">{renderInline(block.content)}</blockquote>;
          case "ul": return <ul key={i} className="list-disc ml-5 my-2 space-y-1">{block.items.map((item, j) => <li key={j} className="text-sm text-gray-700">{renderInline(item)}</li>)}</ul>;
          case "ol": return <ol key={i} className="list-decimal ml-5 my-2 space-y-1">{block.items.map((item, j) => <li key={j} className="text-sm text-gray-700">{renderInline(item)}</li>)}</ol>;
          case "hr": return <hr key={i} className="my-4 border-gray-200" />;
          case "code": return <pre key={i} className="bg-gray-900 text-gray-100 p-4 rounded-lg my-3 text-xs overflow-x-auto"><code>{block.content}</code></pre>;
          case "blank": return <div key={i} className="h-3" />;
          default: return <p key={i} className="text-sm text-gray-700 leading-relaxed my-1">{renderInline(block.content)}</p>;
        }
      })}
    </>
  );
}

type MdBlock = { type: string; content: string; items: string[] };

function parseMarkdown(text: string): MdBlock[] {
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // Blank line
    if (!trimmed.trim()) { blocks.push({ type: "blank", content: "", items: [] }); i++; continue; }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", content: codeLines.join("\n"), items: [] });
      i++; // skip closing ```
      continue;
    }

    // Headings
    if (trimmed.startsWith("#### ")) { blocks.push({ type: "h4", content: trimmed.slice(5), items: [] }); i++; continue; }
    if (trimmed.startsWith("### ")) { blocks.push({ type: "h3", content: trimmed.slice(4), items: [] }); i++; continue; }
    if (trimmed.startsWith("## ")) { blocks.push({ type: "h2", content: trimmed.slice(3), items: [] }); i++; continue; }
    if (trimmed.startsWith("# ")) { blocks.push({ type: "h1", content: trimmed.slice(2), items: [] }); i++; continue; }

    // HR
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { blocks.push({ type: "hr", content: "", items: [] }); i++; continue; }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("> ")) {
        quoteLines.push(lines[i].trimStart().slice(2));
        i++;
      }
      blocks.push({ type: "quote", content: quoteLines.join(" "), items: [] });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].trimStart().replace(/^[-*+]\s/, ""));
        i++;
      }
      blocks.push({ type: "ul", content: "", items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].trimStart().replace(/^\d+\.\s/, ""));
        i++;
      }
      blocks.push({ type: "ol", content: "", items });
      continue;
    }

    // Paragraph
    blocks.push({ type: "p", content: trimmed, items: [] });
    i++;
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Process: bold, italic, inline code, links
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)|(\[(.+?)\]\((.+?)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Bold
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      // Italic
      parts.push(<em key={key++}>{match[4]}</em>);
    } else if (match[5]) {
      // Inline code
      parts.push(<code key={key++} className="bg-gray-100 text-accent px-1 py-0.5 rounded text-xs">{match[6]}</code>);
    } else if (match[7]) {
      // Link
      parts.push(<a key={key++} href={match[9]} target="_blank" rel="noopener noreferrer" className="text-accent underline hover:text-red-700">{match[8]}</a>);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

// ── Helper: extract JSON from AI response ──

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) return text.slice(arrStart, arrEnd + 1);
  return text;
}
