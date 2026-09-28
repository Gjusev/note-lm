import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Projektarchitektur — KI Research Notebook",
  description: "Technische Dokumentation der Projektarchitektur von KI Research Notebook.",
};

const SECTIONS = [
  {
    id: "ueberblick",
    title: "Überblick",
    body: "KI Research Notebook ist eine webbasierte Forschungsplattform, die es Nutzerinnen und Nutzern ermöglicht, Dokumente, Audios und Videos hochzuladen, diese durch KI analysieren zu lassen und gezielte Fragen an die eigenen Quellen zu stellen. Die Antworten basieren ausschließlich auf den hochgeladenen Inhalten und enthalten nachvollziehbare Quellenangaben. Darüber hinaus können automatisch Lernmaterialien wie Zusammenfassungen, Karteikarten, Quizze und Podcasts generiert werden.",
  },
  {
    id: "technologiestack",
    title: "Technologiestack",
    items: [
      ["Frontend", "Next.js 15 (App Router), TypeScript, Tailwind CSS v4"],
      ["Animationen", "GSAP mit ScrollTrigger für Landing Page, Framer Motion für Dialoge"],
      ["Identität", "Lokales Einzelprofil — keine Konten, keine Anmeldung"],
      ["Datenbank", "SQLite (better-sqlite3 + Drizzle ORM, WAL-Modus) im Datenverzeichnis"],
      ["KI / LLM", "Optional: OpenAI API (GPT-4o-mini, Transkription, TTS) — lazy initialisiert"],
      ["PDF-Verarbeitung", "Lokal via PDF.js (pdf-parse); Azure OCR optional für Scans"],
      ["Suche", "SQLite FTS5 mit BM25-Ranking, notizbuchbezogen"],
      ["Medienverarbeitung", "FFmpeg (serverseitig, Node.js Runtime)"],
      ["Dateispeicher", "Lokaler Datenträger (files/), Auslieferung über /api/files/:id"],
    ],
  },
  {
    id: "architektur",
    title: "Lokale Einzelplatz-Architektur",
    body: "Alle Daten liegen in einer SQLite-Datei im Datenverzeichnis (standardmäßig im OS-Nutzerdatenverzeichnis, überschreibbar über NOTELM_DATA_DIR). Originale, Transkripte und generierte Audios liegen als Dateien daneben. Server und Worker teilen sich die Datenbank im WAL-Modus: gleichzeitige Lesezugriffe, serialisierte Schreibzugriffe.",
  },
  {
    id: "authentifizierung",
    title: "Lokale Sitzung",
    body: "Es gibt genau ein lokales Profil, das beim ersten Start automatisch angelegt wird — ohne Registrierung oder Passwort. Der Server lauscht ausschließlich auf 127.0.0.1. Ein HttpOnly-Cookie (notelm_session) schützt /app; ändernde API-Routen prüfen zusätzlich den Origin-Header, damit fremde Websites den Loopback-Server nicht steuern können.",
  },
  {
    id: "datenmodelle",
    title: "Datenmodelle (SQLite)",
    items: [
      ["notebooks", "id, ownerId, title, description, createdAt, updatedAt — indiziert nach ownerId"],
      ["sources", "id, ownerId, notebookId, fileName, fileType, fileSize, storageId, url, status (pending→processing→completed→error), transcriptStorageId, Import-Provenanz (provider, externalId, ...)"],
      ["processingJobs", "Warteschlange für Uploads: id, sourceId, notebookId, status (pending→running→completed/failed), lease-basiert"],
      ["importJobs", "URL-Importe: vollständiger Zustandsautomat (queued→inspecting→downloading→processing→completed/failed/cancelled) mit Lease-Token, Backoff, max. 3 Versuche"],
      ["chunks", "id, sourceId, notebookId, content, chunkIndex — eindeutig pro (sourceId, chunkIndex), FTS5-Index via Trigger"],
      ["messages", "id, notebookId, role (user/assistant), content, citations (JSON) mit sourceId + chunkIndex + text"],
      ["notes", "id, notebookId, title, content, createdAt, updatedAt — persönliche Notizen"],
      ["learningMaterials", "id, notebookId, type (summary/flashcards/quiz/studyGuide/keyInsights/podcastSummary/slides), status, content, audioFileId"],
      ["files", "id, path, fileName, contentType, size — Metadaten der gespeicherten Dateien"],
    ],
  },
  {
    id: "quellenverarbeitung",
    title: "Quellenverarbeitung",
    items: [
      ["Upload", "Datei wird über /api/upload lokal gespeichert und als source-Datensatz angelegt; die Verarbeitung läuft als Job im Worker"],
      ["PDF", "PDF.js (pdf-parse) extrahiert Text lokal seitenweise; für Scans optional Azure Document Intelligence"],
      ["Text/Markdown", "Direkte UTF-8-Extraktion, keine externe Verarbeitung nötig"],
      ["Audio", "OpenAI Whisper (gpt-4o-mini-transcribe) transkribiert die Audiodatei"],
      ["Video", "FFmpeg extrahiert Audio → Whisper transkribiert"],
      ["URL", "Web-Inhalte werden heruntergeladen und als Text verarbeitet"],
      ["Chunking", "Extrahierter Text wird in ~1000-Wort-Abschnitte mit 200-Wort-Überlappung unterteilt"],
    ],
  },
  {
    id: "rag",
    title: "RAG Pipeline",
    body: "Bei einer Frage des Nutzers werden die relevantesten Textabschnitte aus dem aktuellen Notizbuch über SQLite FTS5 mit BM25-Ranking ermittelt (plus je ein repräsentativer Abschnitt pro Quelle ohne Treffer). Diese Abschnitte werden als Kontext an das optionale Sprachmodell übergeben. Die Antwort enthält Quellenangaben mit Verweisen auf die Originaldokumente und Textstellen. Chat-Nachrichten werden mit citations gespeichert. Ohne konfigurierten KI-Anbieter erklären die Fehlermeldungen klar, was fehlt.",
  },
  {
    id: "lernmaterialien",
    title: "Lernmaterialien",
    body: "Nutzer können Lernmaterialien explizit anfordern. Unterstützte Typen: Zusammenfassung (Markdown), Karteikarten (interaktiver Flip-Viewer), Quiz (interaktiv mit Punkteverfolgung), Lernleitfaden, Wichtige Erkenntnisse, Podcast-Zusammenfassung (mit Audio) und Präsentation (Slides-Viewer). Mehrere Versionen pro Typ sind möglich. Die Generierung erfolgt asynchron über OpenAI.",
  },
  {
    id: "podcast",
    title: "Podcast und Audio",
    body: "Podcast-Zusammenfassungen werden als Skript mit zwei Moderatoren generiert. Das Skript wird mit OpenAI TTS (gpt-4o-mini-tts) in zwei Stimmen (Marin und Cedar) aufgenommen. FFmpeg fügt die Audiospuren zusammen. Das Ergebnis wird als MP3 im lokalen Dateispeicher abgelegt und über /api/files/:id ausgeliefert (mit Range-Support).",
  },
  {
    id: "notizen",
    title: "Persönliche Notizen",
    body: "Nutzer können persönliche Notizen in jedem Notizbuch anlegen, bearbeiten und löschen. Notizen liegen in SQLite und sind nach notebookId indiziert. Sie sind unabhängig von den Chat-Nachrichten und Lernmaterialien.",
  },
  {
    id: "routes",
    title: "Routen und Seiten",
    items: [
      ["/", "Landing Page — Schweizer Neo-Brutalistik, GSAP-Animationen, Deutsch"],
      ["/app", "Dashboard — Notizbuch-Übersicht, Neues Notizbuch erstellen"],
      ["/app/notebooks/[id]", "Notizbuch-Arbeitsbereich: Quellen links, Chat mitte, Notizen/Lernmaterialien rechts"],
      ["/architektur", "Öffentliche Architekturseite (diese Seite)"],
      ["/api/notebooks, /api/sources, /api/notes, ...", "Lokale CRUD-API über SQLite (Node.js Runtime)"],
      ["/api/upload", "Datei-Upload → lokale Speicherung + Verarbeitungsjobs"],
      ["/api/chat", "RAG-Chat-Endpunkt mit FTS5-Retrieval und Citations"],
      ["/api/generate", "Lernmaterialien-Generierung"],
      ["/api/files/:id", "Datei-Auslieferung mit HTTP-Range-Support"],
      ["/api/auth/local", "Lokales Profil und Sitzungs-Cookie"],
    ],
  },
  {
    id: "sicherheit",
    title: "Sicherheitsgrenzen",
    items: [
      ["Netzwerk", "Server lauscht nur auf 127.0.0.1 — kein LAN/Internet-Zugriff"],
      ["Sitzung", "HttpOnly-Cookie notelm_session; Middleware leitet ohne Cookie auf die Sitzungseinrichtung um"],
      ["Origin-Prüfung", "Ändernde API-Routen leiten fremde Origins ab"],
      ["Dateipfade", "Auslieferung nur über opaque Datei-IDs mit Pfadvalidierung — niemals Client-Pfade"],
      ["KI optional", "Keine Schlüssel im Voraus nötig; Cloud-Aufrufe nur bei konfigurierter Fähigkeit"],
      ["Runtime", "Medienverarbeitung ausschließlich Node.js Runtime (kein Edge)"],
      ["Dateigrößen", "PDF max 20 MB, Text max 5 MB, Audio max 50 MB, Video max 100 MB"],
      ["SSRF-Schutz", "Import-Worker prüft Ziel-IPs; INGEST_ALLOW_PRIVATE nur für lokale Tests"],
    ],
  },
  {
    id: "umgebungsvariablen",
    title: "Umgebungsvariablen",
    items: [
      ["Lokal", "NOTELM_DATA_DIR (Datenverzeichnis), NOTELM_PORT, NOTELM_USER_NAME — siehe .env.example"],
      ["OpenAI (optional)", "OPENAI_API_KEY, OPENAI_TRANSCRIPTION_MODEL, OPENAI_CHAT_MODEL, OPENAI_TTS_MODEL, OPENAI_TTS_VOICE_HOST_1/2"],
      ["Azure", "AZURE_OCR_ENDPOINT, AZURE_OCR_KEY — Document Intelligence für PDF"],
      ["Verarbeitung", "FFMPEG_PATH (optional, Standard: System-PATH)"],
      ["Limits", "MAX_PDF_MB=20, MAX_TEXT_MB=5, MAX_AUDIO_MB=50, MAX_VIDEO_MB=100, MAX_SOURCES_PER_NOTEBOOK=10"],
    ],
  },
  {
    id: "struktur",
    title: "Projektstruktur",
    items: [
      ["src/app/", "Next.js App Router — Landing, Auth, Protected Layout, API Routes"],
      ["src/app/(protected)/", "Geschützte Seiten mit serverseitiger Session-Prüfung"],
      ["src/lib/", "Auth-Konfiguration, Text-Extraktion, OpenAI, FFmpeg, Auth-Client"],
      ["src/db/auth/", "Drizzle Schema (auth), Datenbankverbindung"],
      ["src/components/", "Wiederverwendbare UI-Komponenten (Upload-Dialog, Toast, etc.)"],
      ["convex/", "Schema, Queries, Mutations, HTTP Actions — 7 Tabellen"],
      ["public/", "Statische Assets, Logo, Bilder"],
    ],
  },
  {
    id: "entwicklung",
    title: "Entwicklungsnotiz",
    body: "Dieses Projekt wurde von GLM-5.1 in einem Coding Pass mit Claude Code programmiert. Die Landing Page folgt dem Schweizer Neo-Brutalismus mit Rot-Akzenten und Papier-Textur. Der interne Arbeitsbereich ist ruhig und NotebookLM-inspiriert mit einem dreispaltigen Layout.",
  },
];

export default function ArchitekturPage() {
  return (
    <div className="min-h-screen bg-paper">
      {/* Nav */}
      <nav className="border-b-2 border-rule flex items-center justify-between px-6 py-4 md:px-12">
        <Link href="/" className="flex items-center gap-3">
          <span className="text-mono-label font-bold tracking-widest">KI RESEARCH NOTEBOOK</span>
        </Link>
        <Link href="/" className="text-mono-label hover:text-accent transition-colors">
          &#91; ZURÜCK &#93;
        </Link>
      </nav>

      {/* Header */}
      <header className="border-b-2 border-rule px-6 py-12 md:px-16 md:py-20">
        <p className="text-mono-label text-accent mb-3">&#91; ARCHITEKTURDOKUMENTATION &#93;</p>
        <h1 className="text-section-title mb-4">Projekt&shy;architektur</h1>
        <p className="text-mono-data max-w-2xl">
          Technischer Überblick über Struktur, Datenfluss und Sicherheitsgrenzen von KI Research
          Notebook.
        </p>
      </header>

      {/* TOC */}
      <aside className="border-b-2 border-rule px-6 py-6 md:px-16">
        <p className="text-mono-label text-accent mb-3">&#91; INHALTSVERZEICHNIS &#93;</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="text-mono-data hover:text-accent transition-colors"
            >
              → {s.title}
            </a>
          ))}
        </div>
      </aside>

      {/* Sections */}
      {SECTIONS.map((s, i) => (
        <section key={s.id} id={s.id} className="border-b-2 border-rule px-6 py-10 md:px-16 md:py-14">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-4">
              <span className="text-mono-label text-accent font-bold">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="text-2xl font-black uppercase tracking-tight mt-2">{s.title}</h2>
            </div>
            <div className="md:col-span-8">
              {"items" in s && s.items ? (
                <dl className="grid grid-cols-1 gap-4">
                  {(s.items as [string, string][]).map(([label, value]) => (
                    <div key={label} className="border-t border-rule/30 pt-3">
                      <dt className="text-mono-label font-bold mb-1">{label}</dt>
                      <dd className="text-mono-data">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {s.body ? <p className="text-mono-data leading-relaxed">{s.body}</p> : null}
            </div>
          </div>
        </section>
      ))}

      {/* Footer */}
      <footer className="px-6 py-8 md:px-12">
        <div className="flex items-center justify-between">
          <span className="text-mono-label opacity-40">REV 2.0</span>
          <Link href="/" className="text-mono-label hover:text-accent transition-colors">
            &#91; ZURÜCK ZUR STARTSEITE &#93;
          </Link>
        </div>
      </footer>
    </div>
  );
}
