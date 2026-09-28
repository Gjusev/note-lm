#!/usr/bin/env node
/**
 * Local setup: verify runtime prerequisites and prepare the data directory.
 * Database migrations apply automatically the first time the app or worker
 * opens the SQLite file (openLocalDb), so there is nothing extra to run here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dataDir =
  process.env.NOTELM_DATA_DIR?.trim() ||
  path.join(process.env.APPDATA || process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "note-lm");

console.log(`note-lm lokale Einrichtung`);
console.log(`Datenverzeichnis: ${dataDir}`);

// Node runtime
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < 20 || (maj === 20 && min < 12)) {
  console.error(`✗ Node ${process.versions.node} — Node ≥ 20.12 erforderlich (--import, loadEnvFile).`);
  process.exit(1);
}
console.log(`✓ Node ${process.versions.node}`);

// Data dirs (db + files + tmp + backups + logs)
for (const sub of ["", "files", "tmp", "backups", "logs"]) {
  fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
}
console.log(`✓ Verzeichnisse angelegt`);

// FFmpeg — optional but required for audio/video transcription
let ffmpeg = "✓ FFmpeg gefunden";
try {
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { stdio: "ignore" });
} catch {
  ffmpeg = `! FFmpeg nicht gefunden — Audio/Video-Transkription ist deaktiviert (Installation: https://ffmpeg.org)`;
}
console.log(ffmpeg);

console.log(`
Fertig. Starten mit:
  npm run build   (einmalig)
  npm run start:local

KI-Funktionen (Chat, Transkription, Lernmaterialien) brauchen optional einen
Anbieter — siehe .env.example. Notizbücher, Quellen, Import und Suche
funktionieren ohne Schlüssel.`);
