"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSession } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface NotebookData {
  _id: string;
  title: string;
  description?: string;
  updatedAt: number;
}

export default function DashboardPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [title, setTitle] = useState("");
  const [showForm, setShowForm] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notebooks: NotebookData[] | undefined = useQuery(api.notebooks.list, session?.user?.id ? { ownerId: session.user.id } : "skip") as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createNotebook = useMutation(api.notebooks.create) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deleteNotebook = useMutation(api.notebooks.remove) as any;
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !session?.user?.id) return;
    const id = await createNotebook({ ownerId: session.user.id, title: title.trim() });
    setTitle("");
    setShowForm(false);
    router.push(`/app/notebooks/${id}`);
  }

  return (
    <div className="p-4 md:p-6 md:p-10 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6 md:mb-10 gap-3">
        <div className="min-w-0">
          <p className="text-mono-label text-accent mb-1 md:mb-2">[ DASHBOARD ]</p>
          <h1 className="text-xl md:text-3xl font-black uppercase tracking-tight truncate">Meine Notizbücher</h1>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="border-2 border-ink px-4 py-2 text-mono-label font-bold hover:bg-accent hover:text-white hover:border-accent transition-colors shrink-0"
        >
          + NEU
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="border-2 border-rule p-6 mb-8">
          <label className="text-mono-label block mb-2">NOTIZBUCH TITEL</label>
          <div className="flex gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="flex-1 border-2 border-rule bg-paper px-4 py-3 text-mono-data focus:outline-none focus:border-accent"
              placeholder="z.B. Seminararbeit Quantenphysik"
              autoFocus
            />
            <button
              type="submit"
              className="bg-accent text-white border-2 border-accent px-6 py-3 text-mono-label font-bold hover:bg-ink hover:border-ink transition-colors"
            >
              ERSTELLEN
            </button>
          </div>
        </form>
      )}

      {!notebooks ? (
        <p className="text-mono-data opacity-50">Laden...</p>
      ) : notebooks.length === 0 ? (
        <div className="border-2 border-rule border-dashed p-16 text-center">
          <p className="text-mono-label text-accent mb-3">&#91; LEER &#93;</p>
          <p className="text-mono-data mb-6">
            Du hast noch keine Notizbücher. Erstelle dein erstes, um loszulegen.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="border-2 border-ink px-6 py-3 text-mono-label font-bold hover:bg-accent hover:text-white hover:border-accent transition-colors"
          >
            + ERSTES NOTIZBUCH
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-rule">
          {notebooks.map((nb) => (
            <div
              key={nb._id}
              className="bg-paper p-6 hover:bg-paper-muted transition-colors group relative"
            >
              {confirmDelete === nb._id ? (
                <div className="absolute inset-0 bg-white/95 z-10 flex flex-col items-center justify-center gap-3 p-6">
                  <p className="text-mono-label text-center">NOTIZBUCH LÖSCHEN?</p>
                  <p className="text-sm text-center truncate max-w-full">{nb.title}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await deleteNotebook({ notebookId: nb._id });
                        setConfirmDelete(null);
                      }}
                      className="bg-accent text-white px-4 py-2 text-mono-label font-bold hover:bg-red-700 transition-colors"
                    >
                      LÖSCHEN
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="border-2 border-rule px-4 py-2 text-mono-label hover:bg-gray-50 transition-colors"
                    >
                      ABBRECHEN
                    </button>
                  </div>
                </div>
              ) : null}
              <Link href={`/app/notebooks/${nb._id}`} className="block">
                <div className="mb-4">
                  <span className="text-mono-label text-accent font-bold">NB</span>
                </div>
                <h2 className="text-lg font-black uppercase tracking-tight mb-2">{nb.title}</h2>
                {nb.description && <p className="text-mono-data opacity-70">{nb.description}</p>}
                <p className="text-mono-label opacity-40 mt-4">
                  {new Date(nb.updatedAt).toLocaleDateString("de-DE")}
                </p>
              </Link>
              <div className="absolute bottom-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Link
                  href={`/app/notebooks/${nb._id}`}
                  className="text-mono-label text-accent hover:underline text-[0.65rem]"
                >
                  ÖFFNEN →
                </Link>
                <span className="text-rule text-xs">|</span>
                <button
                  onClick={() => setConfirmDelete(nb._id)}
                  className="text-mono-label opacity-40 hover:opacity-100 hover:text-accent transition-opacity text-[0.65rem]"
                >
                  LÖSCHEN
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
