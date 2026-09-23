# KI Research Notebook — Benutzerhandbuch

> Version 1.0 — Mai 2026

---

## Inhaltsverzeichnis

1. [Einfuehrung](#1-einfuehrung)
2. [Konto erstellen und anmelden](#2-konto-erstellen-und-anmelden)
3. [Das Dashboard](#3-das-dashboard)
4. [Notizbuch-Arbeitsbereich](#4-notizbuch-arbeitsbereich)
5. [Quellen verwalten](#5-quellen-verwalten)
6. [KI-Chat](#6-ki-chat)
7. [Persoenliche Notizen](#7-persoenliche-notizen)
8. [Lernmaterialien](#8-lernmaterialien)
9. [Web-Suche](#9-web-suche)
10. [Tastenkombinationen und Navigation](#10-tastenkombinationen-und-navigation)
11. [Unterstützte Dateiformate und Grenzen](#11-unterstützte-dateiformate-und-grenzen)
12. [Haeufig gestellte Fragen (FAQ)](#12-haeufig-gestellte-fragen-faq)
13. [Technischer Hintergrund](#13-technischer-hintergrund)

---

## 1. Einfuehrung

**KI Research Notebook** ist eine webbasierte Anwendung im Stil von NotebookLM, die entwickelt wurde, um Ihre Recherchearbeit zu verbessern. Laden Sie Dokumente, Audio- und Videodateien hoch oder importieren Sie Webinhalte — die KI analysiert Ihre Quellen und hilft Ihnen, diese zu verstehen.

### Kernfunktionen

- **Quellen hochladen**: PDFs, Textdateien, Markdown, Audio, Video und Web-URLs
- **KI-gestuetzte Analyse**: Chat mit Ihrer KI ueber den Inhalt Ihrer Quellen
- **Lernmaterialien**: Zusammenfassungen, Karteikarten, Quiz, Lernleitfaeden, Podcasts und mehr
- **Persoenliche Notizen**: Eigene Notizen direkt im Arbeitsbereich erstellen und verwalten
- **Web-Suche**: Suchen Sie im Internet und fuegen Sie Ergebnisse als Quellen hinzu

---

## 2. Konto erstellen und anmelden

### 2.1 Registrieren

1. Oeffnen Sie die Anwendung im Browser
2. Klicken Sie auf **"REGISTRIEREN"** oder navigieren Sie zu `/register`
3. Fuellen Sie das Formular aus:
   - **Name**: Ihr voller Name
   - **E-Mail**: Eine gueltige E-Mail-Adresse
   - **Passwort**: Mindestens 8 Zeichen (die Passwortstaerke wird angezeigt)
4. Klicken Sie auf **"KONTO ERSTELLEN"**
5. **E-Mail bestaetigen**: Sie erhalten eine Bestaetigungsmail. Klicken Sie auf den Link darin, um Ihr Konto zu aktivieren.

> **Hinweis**: Sie koennen sich auch ueber **Google** anmelden, indem Sie auf den Button "MIT GOOGLE ANMELDEN" klicken.

### 2.2 Anmelden

1. Navigieren Sie zu `/login`
2. Geben Sie Ihre **E-Mail** und Ihr **Passwort** ein
3. Klicken Sie auf **"ANMELDEN"**
4. Alternativ: Verwenden Sie **"MIT GOOGLE ANMELDEN"**

### 2.3 Passwort zuruecksetzen

1. Klicken Sie auf der Anmeldeseite auf **"Passwort vergessen?"**
2. Geben Sie Ihre E-Mail-Adresse ein
3. Sie erhalten einen Reset-Link per E-Mail (gueltig fuer 30 Minuten)
4. Klicken Sie den Link und vergeben Sie ein neues Passwort

### 2.4 Abmelden

Klicken Sie in der Navigation oben rechts auf **"ABMELDEN"**. Ein Bestaetigungsdialog erscheint — klicken Sie auf **"JA, ABMELDEN"** zum Abmelden oder **"ZURUECK"** zum Abbrechen.

---

## 3. Das Dashboard

Nach der Anmeldung gelangen Sie zum Dashboard unter `/app`.

### 3.1 Notizbuecher uebersicht

- Alle Ihre Notizbuecher werden als Karten in einem responsiven Grid angezeigt (1–3 Spalten je nach Bildschirmgroesse)
- Jede Karte zeigt: **Titel**, **Beschreibung** und **Letzte Aktualisierung**
- Klicken Sie auf eine Karte, um den Arbeitsbereich zu oeffnen

### 3.2 Neues Notizbuch erstellen

1. Klicken Sie oben auf **"+ NEUES NOTIZBUCH"**
2. Ein Inline-Formular erscheint:
   - **Titel** (Pflichtfeld): Geben Sie Ihrem Notizbuch einen aussagekraeftigen Namen
   - **Beschreibung** (optional): Eine kurze Beschreibung des Themas
3. Klicken Sie auf **"ERSTELLEN"** oder druecken Sie Enter

### 3.3 Notizbuch loeschen

- Im Arbeitsbereich eines Notizbuchs gibt es unten links den Button **"Notizbuch loeschen"**
- Es erscheint ein Bestaetigungsdialog
- **Achtung**: Das Loeschen eines Notizbuchs entfernt unwiderruflich alle Quellen, Chat-Nachrichten, Notizen und Lernmaterialien darin

---

## 4. Notizbuch-Arbeitsbereich

Der Arbeitsbereich unter `/app/notebooks/[id]` besteht aus drei Bereichen:

### Layout-Uebersicht

```
┌──────────────┬────────────────────────┬──────────────────┐
│   QUELLEN    │                        │  LERNMATERIALIEN │
│   URL        │      KI-CHAT           │                  │
│   SUCHE      │                        │  Quelldetails    │
│   NOTIZEN    │                        │                  │
└──────────────┴────────────────────────┴──────────────────┘
```

### 4.1 Linker Bereich (Seitenleiste, 288px)

- **Desktop**: Statisch sichtbar
- **Mobil**: Ueber Hamburger-Icon ein-/ausblendbar, als Overlay mit Hintergrundabdunklung
- Enthaelt 4 Tabs: QUELLEN, URL, SUCHE, NOTIZEN

### 4.2 Mittlerer Bereich (Chat)

- Der KI-Chat-Bereich nimmt den grossten Teil des Bildschirms ein
- Oberhalb des Chats: Quelluebersicht mit Status-Punkten
- Unten: Texteingabe fuer neue Nachrichten

### 4.3 Rechter Bereich (320px, nur Desktop)

- Zwei Ansichten:
  - **Lernmaterialien** (Standardansicht): 7 Materialtypen zum Generieren und Ansehen
  - **Quelldetails**: Aktiviert durch Klick auf eine Quelle in der linken Seitenleiste
- **Mobil**: Lernmaterialien sind ueber einen Button im Chat-Header als aufklappbares Panel von unten erreichbar

---

## 5. Quellen verwalten

Quellen sind die Grundlage fuer alle KI-Funktionen. Sie koennen bis zu **10 Quellen pro Notizbuch** hinzufuegen.

### 5.1 Dateien hochladen

1. Klicken Sie im Tab **QUELLEN** auf **"+ QUELLE HINZUFUEGEN"**
2. Der Upload-Dialog oeffnet sich
3. Sie koennen:
   - **Dateien hineinziehen** (Drag & Drop)
   - **Klicken**, um den Dateibrowser zu oeffnen
4. Unterstuetzte Formate:

| Kategorie | Formate | Maximale Groesse |
|---|---|---|
| Dokumente | PDF, TXT, MD | 20 MB (PDF) / 5 MB (TXT, MD) |
| Audio | MP3, WAV, M4A, OGG, WEBM | 50 MB |
| Video | MP4, WEBM, MOV | 100 MB |

5. Nach dem Upload wird die Datei automatisch verarbeitet:
   - **PDF**: Text wird extrahiert (inkl. OCR fuer gescannte Dokumente)
   - **Text/Markdown**: Direkte Textuebernahme
   - **Audio**: Automatische Transkription ueber KI
   - **Video**: Audio wird extrahiert und transkribiert

### 5.2 Verarbeitungsstatus

Jede Quelle zeigt einen farbigen Statusindikator:

| Farbe | Bedeutung |
|---|---|
| Gruen (statisch) | Abgeschlossen — Quelle ist bereit |
| Gelb (pulsierend) | Wird verarbeitet... |
| Rot | Fehler bei der Verarbeitung |
| Grau | Ausstehend |

### 5.3 URL als Quelle hinzufuegen

1. Wechseln Sie zum Tab **URL** in der linken Seitenleiste
2. Geben Sie eine Web-URL ein (z.B. `https://example.com/artikel`)
3. Klicken Sie auf **"HINZUFUEGEN"** oder druecken Sie Enter
4. Die Anwendung laedt die Webseite, extrahiert den Textinhalt und fuegt ihn als Quelle hinzu

> **Hinweis**: Der Text wird automatisch bereinigt — Navigation, Footer, Skripte und Styles werden entfernt.

### 5.4 Quelldetails ansehen

1. Klicken Sie im Tab **QUELLEN** auf eine beliebige Quelle
2. Im rechten Bereich (Desktop) oder in einem Panel erscheinen:
   - **Metadaten**: Dateityp, Groesse, URL, Status
   - **Textabschnitte**: Alle extrahierten Text-Chunks mit Indexnummer

### 5.5 Quelle loeschen

Klicken Sie auf das Loesch-Symbol neben einer Quelle. Ein Bestaetigungsdialog erscheint.

---

## 6. KI-Chat

Der Chat ist das Herzstueck des Arbeitsbereichs. Die KI antwortet ausschliesslich basierend auf Ihren hochgeladenen Quellen.

### 6.1 Eine Frage stellen

1. Klicken Sie in das Texteingabefeld am unteren Rand des Chat-Bereichs
2. Geben Sie Ihre Frage ein
3. Druecken Sie Enter oder klicken Sie auf den Pfeil-Button
4. Die KI sucht in Ihren Quellen nach relevanten Informationen und erstellt eine Antwort

### 6.2 Quellenangaben (Zitate)

- Jede KI-Antwort kann **Zitate** enthalten
- Zitate werden als kleine Badges unter der Antwort angezeigt
- Jedes Zitat zeigt den **Dateinamen** der Quelle
- Klicken Sie auf ein Zitat, um mehr Details zur Quelle zu sehen

### 6.3 Vorgeschlagene Fragen

Wenn der Chat leer ist, werden **kontextabhaengige Fragen** vorgeschlagen. Diese basieren auf den Typen der hochgeladenen Quellen (z.B. andere Vorschlaege fuer Audio- als fuer PDF-Quellen).

### 6.4 Chat loeschen

Klicken Sie im Chat-Header auf das Loesch-Symbol. Alle Nachrichten im aktuellen Notizbuch werden unwiderruflich entfernt.

### 6.5 Quelluebersicht

Oberhalb des Chats wird eine Leiste mit Quell-Badges angezeigt:
- Jede Quelle wird als kleines Badge mit einem Status-Punkt angezeigt
- Maximal 6 Quellen werden angezeigt

---

## 7. Persoenliche Notizen

Im Tab **NOTIZEN** der linken Seitenleiste koennen Sie eigene Notizen erstellen und verwalten.

### 7.1 Notiz erstellen

1. Wechseln Sie zum Tab **NOTIZEN**
2. Klicken Sie auf **"+ NEUE NOTIZ"**
3. Geben Sie einen **Titel** und den **Inhalt** ein
4. Klicken Sie auf **"SPEICHERN"**

### 7.2 Notiz bearbeiten

Klicken Sie auf eine bestehende Notiz, um sie zu bearbeiten. Aendern Sie Titel oder Inhalt und speichern Sie.

### 7.3 Notiz loeschen

Klicken Sie auf das Loesch-Symbol neben der Notiz. Eine Bestaetigung wird angefordert.

### 7.4 Anzeige

- Notizen werden nach dem letzten Aktualisierungsdatum sortiert (neueste oben)
- Das Erstellungsdatum wird angezeigt

---

## 8. Lernmaterialien

Die Anwendung kann 7 verschiedene Lernmaterialien aus Ihren Quellen generieren. Alle Materialien werden im rechten Bereich (Desktop) oder im mobilen Bottom-Sheet angezeigt.

### 8.1 Uebersicht der Materialtypen

| Material | Beschreibung |
|---|---|
| **Zusammenfassung** | Strukturierte Zusammenfassung mit Ueberschriften |
| **Karteikarten** | 15–20 interaktive Karten mit Vorder- und Rueckseite zum Umdrehen |
| **Quiz** | 10 Multiple-Choice-Fragen mit 4 Optionen, Punktebewertung und Erklaerungen |
| **Lernleitfaden** | Strukturierter Leitfaden mit Lernzielen, Konzepten und Empfehlungen |
| **Kernerkenntnisse** | Top 10 Erkenntnisse mit Beschreibung und Quellenangabe |
| **Podcast** | Zwei-Moderator-Skript mit Audio-Player, Geschwindigkeitskontrolle und Download |
| **Praesentation** | 8–12 interaktive Folien mit Titel und Inhalt |

### 8.2 Material generieren

1. Klicken Sie bei einem Materialtyp auf **"GENERIEREN"**
2. Der Status wechselt zu "Wird erstellt..." (gelb pulsierend)
3. Die KI analysiert alle Ihre Quellen und erstellt das Material
4. Sobald fertig, wechselt der Status zu "Abgeschlossen" (gruen)
5. Klicken Sie auf **"ANSEHEN"**, um das Material zu oeffnen

### 8.3 Materialversionen

- Sie koennen dasselbe Material mehrfach generieren
- Versionen werden als **v1, v2, v3** usw. angezeigt
- Mit **"+ NEU"** erstellen Sie eine neue Version
- Jede Version kann unabhaengig angesehen oder geloescht werden

### 8.4 Material exportieren

Jedes fertige Material kann in verschiedenen Formaten heruntergeladen werden:

| Format | Dateiendung | Beschreibung |
|---|---|---|
| Markdown | `.md` | Formatiertes Markdown |
| Plaintext | `.txt` | Reiner Text |
| JSON | `.json` | Strukturierte Daten (fuer Karteikarten, Quiz, Folien) |

Klicken Sie auf das Export-Dropdown-Menue und waehlen Sie das gewuenschte Format.

### 8.5 Material als Quelle hinzufuegen

Klicken Sie auf **"+ ALS QUELLE HINZUFUEGEN"**, um den Inhalt eines Materials als neue Quelle in Ihr Notizbuch zu importieren. So koennen Sie die KI gezielt zu bestimmten Materialien befragen.

### 8.6 Podcast-Player

Der Podcast-Player bietet folgende Funktionen:

| Funktion | Beschreibung |
|---|---|
| Play/Pause | Audio abspielen oder pausieren |
| Fortschrittsbalken | Beliebige Position anwaehlen |
| +/- 10 Sekunden | 10 Sekunden vor- oder zurueckspringen |
| Geschwindigkeit | 0,5x, 0,75x, 1x, 1,25x, 1,5x, 2x |
| Download | MP3-Datei herunterladen |

Der Podcast wird von zwei virtuellen Moderatoren mit unterschiedlichen Stimmen gesprochen.

### 8.7 Karteikarten-Viewer

- Karten werden einzeln angezeigt
- **Klicken** Sie auf die Karte, um sie umzudrehen (Vorder-/Rueckseite)
- Navigation mit **Pfeiltasten** oder Navigationspunkten
- 15–20 Karten pro Satz

### 8.8 Quiz-Modus

- 10 Multiple-Choice-Fragen
- Waehlen Sie eine Antwort aus
- **Richtig**: Gruene Hervorhebung
- **Falsch**: Rote Hervorhebung + richtige Antwort anzeigen
- Nach jeder Antwort wird eine **Erklaerung** angezeigt
- Gesamtpunktzahl wird am Ende angezeigt

### 8.9 Folien-Viewer

- 8–12 Folien mit Titel und Inhalt
- Navigation mit **Vor-/Zurueck-Pfeilen** oder Navigationspunkten
- Folien werden in einem Viewer-Fenster angezeigt

---

## 9. Web-Suche

### 9.1 Suchfunktion nutzen

1. Wechseln Sie zum Tab **SUCHE** in der linken Seitenleiste
2. Geben Sie Ihren Suchbegriff ein
3. Druecken Sie Enter oder klicken Sie auf das Such-Icon
4. Suchergebnisse werden mit **Titel**, **URL** und **Auszug** angezeigt

### 9.2 Suchergebnis als Quelle hinzufuegen

- Jedes Suchergebnis hat einen Button **"+ ALS QUELLE HINZUFUEGEN"**
- Klicken Sie darauf, um den Inhalt der Webseite als Quelle zu importieren
- Die Anwendung laedt die Seite automatisch und extrahiert den Text

---

## 10. Tastenkombinationen und Navigation

### Allgemeine Navigation

| Aktion | Weg |
|---|---|
| Zum Dashboard | Klicken Sie auf **"NOTIZBUECHER"** in der Navigation |
| Zurueck zum Dashboard (im Arbeitsbereich) | Pfeil-Icon oben links |
| Abmelden | **"ABMELDEN"** in der Navigation |

### Mobile Navigation

| Aktion | Weg |
|---|---|
| Seitenleiste oeffnen/schliessen | Hamburger-Icon oben links |
| Lernmaterialien oeffnen | Materialien-Button im Chat-Header |
| Seitenleiste schliessen | Klick auf den abgedunkelten Hintergrund |

---

## 11. Unterstuetzte Dateiformate und Grenzen

### Dateiformate

| Typ | Formate |
|---|---|
| Dokumente | `.pdf`, `.txt`, `.md` |
| Audio | `.mp3`, `.wav`, `.m4a`, `.ogg`, `.webm` |
| Video | `.mp4`, `.webm`, `.mov` |

### Grenzen

| Parameter | Wert |
|---|---|
| Maximale Quellen pro Notizbuch | 10 |
| Maximale PDF-Groesse | 20 MB |
| Maximale Textdatei-Groesse | 5 MB |
| Maximale Audio-Groesse | 50 MB |
| Maximale Video-Groesse | 100 MB |
| Passwort-Mindestlaenge | 8 Zeichen |
| Passwort-Reset-Link gueltig | 30 Minuten |

### Textverarbeitung

- Text wird in Abschnitte von ca. **1000 Woertern** aufgeteilt
- Ueberlappung zwischen Abschnitten: **200 Woerter**
- Dies gewaehrleistet, dass kein Kontext an den Schnittstellen verloren geht

---

## 12. Haeufig gestellte Fragen (FAQ)

### F: Welche Sprachen unterstuetzt der Chat?
**A**: Die KI antwortet in der Sprache, in der Sie die Frage stellen. Standardmaessig wird Deutsch verwendet, wenn die Frage auf Deutsch gestellt wird.

### F: Kann ich YouTube-Videos importieren?
**A**: Nein, es werden nur hochgeladene Dateien unterstuetzt. Sie koennen jedoch Web-URLs ueber den URL-Tab importieren.

### F: Wie genau ist die KI?
**A**: Die KI antwortet ausschliesslich basierend auf Ihren Quellen. Wenn die Quellen nicht genug Informationen enthalten, wird die KI dies mitteilen und keine Spekulationen anstellen.

### F: Kann ich mehrere Quellen gleichzeitig hochladen?
**A**: Jede Quelle muss einzeln hochgeladen werden. Sie koennen jedoch bis zu 10 Quellen pro Notizbuch hinzufuegen.

### F: Was passiert mit meinen Daten?
**A**: Ihre Daten werden in einer selbtsgehosteten Convex-Datenbank gespeichert. Authentifizierungsdaten werden in einer separaten PostgreSQL-Datenbank gespeichert. Es werden keine Daten an Dritte weitergegeben.

### F: Kann ich den Chat zuruecksetzen?
**A**: Ja, klicken Sie auf das Loesch-Symbol im Chat-Header. Dies loescht alle Nachrichten, nicht jedoch die Quellen.

### F: Wie lange dauert die Verarbeitung einer Quelle?
**A**: Textdateien sind fast sofort fertig. PDFs dauern einige Sekunden. Audio und Video koennen je nach Laenge und Groesse mehrere Minuten in Anspruch nehmen.

### F: Kann ich generierte Materialien bearbeiten?
**A**: Materialien koennen nicht direkt bearbeitet werden. Sie koennen jedoch eine neue Version generieren lassen oder den Inhalt als Quelle hinzufuegen und dann ueber den Chat gezielt darauf eingehen.

### F: Ist die Anwendung mobil nutzbar?
**A**: Ja, die Anwendung ist responsiv gestaltet. Auf mobilen Geraeten werden die Seitenleiste als Overlay und die Lernmaterialien als aufklappbares Panel von unten angezeigt.

---

## 13. Technischer Hintergrund

Eine detaillierte technische Dokumentation finden Sie auf der oeffentlichen Seite unter **`/architektur`**. Diese Seite beschreibt:

- Verwendete Technologien (Next.js, Convex, OpenAI, Better Auth)
- Zwei-Datenbank-Architektur (PostgreSQL fuer Auth, Convex fuer Produktdaten)
- Datenverarbeitungspipeline (Upload, Textextraktion, Chunking, RAG)
- Sicherheitskonzepte
- Projektstruktur

---

## Support und Feedback

Bei Fragen oder Problemen wenden Sie sich an den Administrator der Anwendung.

---

*Erstellt mit GLM-5.1 + Claude Code*
