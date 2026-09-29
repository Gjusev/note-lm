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
    body: "note-lm ist eine lokale Desktop-Anwendung (Tauri 2) für Forschung und Studium mit überprüfbaren Quellen: Dokumente, Web-Links, Tabellen, Audio und Video werden importiert, versioniert und durchsuchbar. Jede Aussage (Aussage/Claim) verankert ihre Evidenz in einer unveränderlichen Quellversion — mit Seite, Zitatausschnitt oder Zeitintervall — und lässt sich per Klick im Original öffnen. Alles läuft innerhalb des einen installierten Programms: kein Server, kein Container, kein manuell installiertes Runtime.",
  },
  {
    id: "technologiestack",
    title: "Technologiestack",
    items: [
      ["Desktop", "Tauri 2 (Rust-Host) + React/Vite-Frontend, TanStack Query, PDF.js, Lucide"],
      ["Engine", "Node.js-Seitenprozess (gebündelt, gepinnte Runtime) spricht NDJSON über stdio mit dem Rust-Host"],
      ["Datenbank", "SQLite (better-sqlite3 + Drizzle, WAL, FTS5 + sqlite-vec) im OS-Datenverzeichnis"],
      ["Suche", "Hybrid: FTS5 (BM25) + Vektoren (vec0) mit RRF-Fusion und geschütztem Vektor-Kandidatenkopf"],
      ["KI lokal", "llama.cpp (Chat + Embeddings, GPU-fähig) und whisper.cpp (Transkription) — von der App verwaltet"],
      ["KI optional", "API-Anbieter (OpenAI, OpenRouter, custom OpenAI-kompatibel) mit Schlüsseln im OS-Keyring"],
      ["Medien", "FFmpeg (gepinnt, gebündelt): Audio-Extraktion, MP3-Segmentierung mit echten Zeitmarken"],
      ["Installer", "NSIS (~99 MB) — enthält Engine-Runtime, FFmpeg, llama.cpp und Beispielnotizbuch"],
    ],
  },
  {
    id: "architektur",
    title: "Engine-over-Stdio",
    body: "Der Rust-Host startet die Engine als Kindprozess und spricht ein getipptes NDJSON-Protokoll über stdio (Anfrage/Antwort nach ID, Fortschritts-Events, geheimer Schlüssel-Kanal). Die Engine ist der einzige Schreiber der Datenbank: Worker laufen mit Lease-Fencing, Checkpoints und Intent-Trennung (laufend/pausiert/abgebrochen) — Pausieren, Fortsetzen, Abbrechen und Wiederherstellen nach Absturz sind installiert geprüft. Ein Fehlstart der GUI kann den Motor nicht mehr totlegen: Die Ressourcenauflösung deckt jedes Layout ab.",
  },
  {
    id: "versioniertevidenz",
    title: "Versionierte Evidenz",
    items: [
      ["source_versions", "Unveränderliche Schnappschüsse: Original-Bytes (SHA-256), Seiten-/Tabellen-/Segment-Nebendateien"],
      ["claims + anchors", "Aussagen mit Ankern auf genau einer Version; Seite nur wenn wirklich bekannt, Zeitintervall für Medien — nie erfunden"],
      ["Provenienz", "Chunks tragen die Version, die sie erzeugt hat; Zitationen stempeln die Version zum Abrufzeitpunkt"],
      ["review_proposals", "Deterministische Änderungsprüfung (Zitat verschoben/verschwunden); Annehmen verankert neu, Ablehnen behält — Historie bleibt"],
      ["calculations", "Reproduzierbare Berechnungen über CSV-Versionen mit strenger Validierung (keine LLM-Arithmetik)"],
      ["packages", "Portable Forschungspakete (formatVersion 2): SHA-geprüft, mit oder ohne Originale, wiederherstellbar"],
    ],
  },
  {
    id: "quellenverarbeitung",
    title: "Quellenverarbeitung",
    items: [
      ["Import", "Dateien (PDF, CSV, Audio, Video, Text) und URLs; erneutes Importieren wird zur neuen Version derselben Quelle (Hash-Deduplizierung)"],
      ["PDF", "pdf-parse extrahiert seitenweise lokal; der Reader zeigt die Original-Seite (PDF.js)"],
      ["Audio/Video", "FFmpeg → 16-kHz-WAV → whisper.cpp (-oj) mit echten Segmentzeiten; segmentierte Pfade mit Checkpoints pro Segment"],
      ["Medien-Evidenz", "Ein Chunk pro Segment; Zitationen tragen [mm:ss–mm:ss] und öffnen den Abschnitt im Player"],
      ["URL", "SSRF-geprüfter Download (IP-Prüfung pro Hop), Range-fähige Fortsetzung"],
    ],
  },
  {
    id: "rag",
    title: "RAG-Pipeline",
    body: "Hybride Suche pro Notizbuch: FTS5 und Vektoren laufen getrennt, RRF fusioniert — wobei die Spitzenkandidaten der Vektorseite geschützt sind (sprachübergreifende Evidenz wird nicht von gleichsprachigen Distraktoren verdrängt; +50pp gemessen). Embedding-Rezepte (Modell, Pooling, Dimension) sind Teil der Profilidentität: Ein Rezeptwechsel baut einen neuen Index und aktiviert erst nach Fertigstellung — alte Indizes bleiben erhalten. Ohne KI-Anbieter degradation die Suche ehrlich auf Textsuche mit sichtbarem Hinweis.",
  },
  {
    id: "oberflaeche",
    title: "Arbeitsbereich",
    items: [
      ["Shell", "Navigation links (Quellen, Notizen, Aussagen, Berechnungen, Materialien), flexibler Mittelpunkt, kontextueller Inspector — Trennflächen per Tastatur verstellbar"],
      ["Reader", "PDF mit Textauswahl → Aussage speichern oder in Notiz einfügen ([@claim:id]-Verweise sind navigierbar); Versionen umschaltbar"],
      ["Matrix", "Aussagen × Quellen: Evidenz, offene Prüfung, Historie — Zellen öffnen die verankerte Version; „nicht gefunden“ nennt die aufgezeichnete Suche"],
      ["Onboarding", "Erste Ausführung: Ressourcen-Erkennung in Echtzeit, KI einrichten (lokal per Katalog / API mit Test / später), Beispielnotizbuch"],
      ["Aktivität", "Zentrum für Jobs: Phasen, Fortschritt, Pausieren/Fortsetzen/Abbrechen, Wiederherstellung"],
    ],
  },
  {
    id: "pruefung",
    title: "Prüfung und Evaluation",
    body: "Eine 19-Gate-Pipeline baut und prüft jedes Release: Typecheck, 343 Unit-Tests, Engine-E2E, Bundle-ABI, stille Installation, Smoke ohne PATH, Absturz-Wiederherstellung (Kill während des Downloads → Fortsetzung), und volle Durchläufe (Recherche, Revision, Berechnung, Stimme) vom installierten Paket. Ein UI-Fahrwerk klickt die echte Oberfläche gegen die echte Engine (17 Schritte). Messungen — Retrieval-Benchmarks, WER mit natürlicher Sprache, Änderungsprüfung — liegen unter eval/, einschließlich negativer Ergebnisse (PageIndex nicht angenommen; Docling zurückgestellt).",
  },
  {
    id: "struktur",
    title: "Projektstruktur",
    items: [
      ["src-tauri/", "Rust-Host: Fenster, Tray, Keyring, Engine-Seitenprozess, NSIS-Bundling"],
      ["src/desktop/", "React/Vite-UI (produktive Oberfläche)"],
      ["src/engine/", "NDJSON-Engine: Dispatch, Job-Lanes, Fähigkeiten-Auflösung"],
      ["src/lib/services/", "Domain: Quellen, Versionen, Aussagen, Prüfung, Suche, Modelle, Pakete"],
      ["src/db/local/", "SQLite-Schema + append-only Migrationen"],
      ["src/app/", "Next.js-Entwicklungsoberfläche (nur Dev-Werkzeug, kein Produktionsziel)"],
      ["eval/", "Corpora, Messwerkezeuge, Berichte (auch negative Ergebnisse)"],
    ],
  },
  {
    id: "sicherheit",
    title: "Sicherheitsgrenzen",
    items: [
      ["Lokal zuerst", "Kein Konto, kein Server; alle Daten im OS-Datenverzeichnis"],
      ["KI-Ort sichtbar", "Pro Fähigkeit ersichtlich, wo verarbeitet wird („Auf diesem Computer“ / Anbieter); Offline-Modus blockiert Remote-Aufrufe zur Laufzeit"],
      ["Schlüssel", "OS-Keyring; der geheime Kanal zur Engine ist typisiert, Demultiplexed und loggt niemals Werte"],
      ["Dateipfade", "Öffnen externer Dateien nur nach lexikalischer Validierung gegen das Datenverzeichnis"],
      ["SSRF", "URL-Import prüft Ziel-IPs (IPv4+IPv6) bei jedem Hop"],
      ["Pakete", "Import verifiziert SHA-256 vor jeder Wiederherstellung; abgebrochene Wiederherstellungen rollen vollständig zurück"],
    ],
  },
  {
    id: "entwicklung",
    title: "Entwicklungsnotiz",
    body: "Entstanden als lokale Konversion einer früheren Web-App zu einer Tauri-Desktop-Anwendung — Convex und die alte Auth sind entfernt, die SQLite-Dienste sind deren portierte Nachfolger (Provenanz-Kommentare im Code nennen die Herkunft). Design: Schweizer Neo-Brutalismus mit Papier, Tinte und zurückhaltendem Rot. Beiträge willkommen — siehe CONTRIBUTING.md; Architektur-Details in ARCHITECTURE.md.",
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
