#!/usr/bin/env node
/**
 * Wizard drive (onboarding proof): same rig as drive-ui.mjs — engine-server on
 * 3128 (fresh data dir, the real packaged engine child) + desktop vite dev on
 * 5180 — but drives ONLY the first-run onboarding wizard:
 *
 *   W1 welcome renders (real DOM, German copy, skippable)
 *   W2 resource checklist shows real statuses from the engine ops
 *   W3 skip works + flag persists (no re-appearance after reload)
 *   W4 Settings restart -> local card shows the catalog download buttons
 *      (asserted only — no 469 MB download in this drive)
 *   W5 Escape closes (keyboard)
 *
 * Usage: node eval/ui-drive/drive-wizard.mjs
 * Artifacts: eval/ui-drive/artifacts/wizard-*.png + wizard-report.json
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.join(here, "artifacts");
fs.mkdirSync(artifacts, { recursive: true });
for (const f of fs.readdirSync(artifacts)) if (f.startsWith("wizard-")) fs.rmSync(path.join(artifacts, f));

const NEXT_PORT = 3128;
const VITE_PORT = 5180;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-wizard-"));
const report = { steps: [], consoleErrors: [], pageErrors: [], dataDir };
const log = (m) => console.log(`[wizard] ${m}`);

const step = async (name, fn) => {
  const t0 = Date.now();
  try {
    await fn();
    report.steps.push({ name, ok: true, ms: Date.now() - t0 });
    log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    report.steps.push({ name, ok: false, ms: Date.now() - t0, error: String(err?.message ?? err).slice(0, 500) });
    log(`FAIL ${name}: ${String(err?.message ?? err).slice(0, 500)}`);
    throw err;
  }
};

const waitForHttp = async (url, timeoutMs, hint) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 302 || res.status === 307) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > timeoutMs) throw new Error(`server not ready: ${url} (${hint})`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

const engineProc = spawn(process.execPath, [path.join(here, "engine-server.mjs"), "--port", String(NEXT_PORT), "--data", dataDir], {
  cwd: repo, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"],
});
const viteProc = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "src/desktop/vite.config.ts"], {
  cwd: repo, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"],
});
const cleanup = () => {
  for (const proc of [engineProc, viteProc]) {
    if (proc.exitCode === null && proc.signalCode === null) {
      try { execFileSync("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" }); } catch { /* gone */ }
    }
  }
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

let browser;
try {
  await step("server up (engine 3128 frisch, vite 5180)", async () => {
    await waitForHttp(`http://127.0.0.1:${NEXT_PORT}/health`, 60_000, "engine-server boot");
    await waitForHttp(`http://localhost:${VITE_PORT}/`, 60_000, "vite dev boot");
  });

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon/i.test(msg.text())) report.consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on("pageerror", (err) => report.pageErrors.push(String(err).slice(0, 300)));
  const shot = (name) => page.screenshot({ path: path.join(artifacts, name) });

  // W1: welcome renders over the fresh library
  await step("W1 Willkommen rendert (3 Schritte, Überspringen)", async () => {
    await page.goto(`http://localhost:${VITE_PORT}/`);
    const dlg = page.getByRole("dialog", { name: "Willkommen bei note-lm" });
    await dlg.waitFor();
    for (const s of ["Ressourcen-Erkennung", "KI einrichten", "Beispiel laden"]) {
      await dlg.getByText(s).waitFor();
    }
    await dlg.getByRole("button", { name: "Weiter", exact: true }).waitFor();
    await dlg.getByRole("button", { name: "Überspringen" }).waitFor();
  });
  await shot("wizard-01-welcome.png");

  // W2: checklist shows REAL statuses (fresh dir: chat/embed missing, runtimes integrated)
  await step("W2 Ressourcen-Checkliste mit echten Status", async () => {
    const dlg = page.getByRole("dialog", { name: "Ressourcen-Erkennung" });
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
    await dlg.waitFor();
    const chatRow = dlg.locator("li").filter({ hasText: "KI-Chat" });
    await chatRow.getByText("Nicht konfiguriert").waitFor({ timeout: 30_000 }); // real scan done
    await chatRow.getByRole("button", { name: "Einrichten" }).waitFor();          // fix action wired
    for (const row of ["Embeddings", "Transkription", "FFmpeg", "llama.cpp", "Modelle auf Festplatte"]) {
      await dlg.locator("li").filter({ hasText: row }).first().waitFor();
    }
    await dlg.locator("li").filter({ hasText: "FFmpeg" }).getByText("Bereit").waitFor();
    await dlg.locator("li").filter({ hasText: "Modelle auf Festplatte" }).getByText("Nicht konfiguriert").waitFor();
  });
  await shot("wizard-02-ressourcen.png");

  // W3: skip closes + flag persists across a reload
  await step("W3 Überspringen schließt, Flagge hält nach Reload", async () => {
    await page.getByRole("button", { name: "Überspringen" }).click();
    await page.getByRole("dialog", { name: "Ressourcen-Erkennung" }).waitFor({ state: "detached" });
    await page.getByRole("heading", { name: "Bibliothek" }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Bibliothek" }).waitFor();
    await page.waitForTimeout(1500); // queries resolve; wizard must NOT come back
    const count = await page.getByRole("dialog").count();
    if (count !== 0) throw new Error(`Wizard erschien nach Überspringen erneut (${count} Dialoge)`);
  });

  // W4: Settings restart -> local card with catalog download buttons
  await step("W4 Einführung erneut starten -> Lokal-Karte mit Download-Buttons", async () => {
    await page.getByRole("link", { name: "Einstellungen" }).click();
    await page.getByRole("heading", { name: "Einstellungen · IA" }).waitFor();
    await page.getByRole("button", { name: "Einführung erneut starten" }).click();
    const dlg = page.getByRole("dialog", { name: "Willkommen bei note-lm" });
    await dlg.waitFor();
    await dlg.getByRole("button", { name: "Weiter", exact: true }).click(); // -> Ressourcen
    await page.getByRole("button", { name: "Weiter", exact: true }).click(); // -> KI einrichten
    await page.getByRole("dialog", { name: "KI einrichten" }).waitFor();
    await page.getByRole("button", { name: "Lokal — Privat" }).click();
    const buttons = page.getByRole("button", { name: "Herunterladen & aktivieren" });
    await buttons.first().waitFor({ timeout: 30_000 });
    const n = await buttons.count();
    if (n < 2) throw new Error(`Nur ${n} Katalog-Download-Buttons sichtbar (chat+embed erwartet)`);
    const rec = await page.getByText("Empfohlen", { exact: true }).count();
    if (rec < 1) throw new Error("Keine Empfohlen-Markierung am kleinen Standard");
    await page.getByRole("button", { name: "Später — Nur Textsuche" }).waitFor(); // honest third path
  });
  await shot("wizard-03-lokal.png");

  // W5: Escape closes (keyboard path)
  await step("W5 Escape schließt die Einführung", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "KI einrichten" }).waitFor({ state: "detached" });
  });

  await step("keine Console-Fehler", () => {
    if (report.consoleErrors.length || report.pageErrors.length) {
      throw new Error(`console errors: ${JSON.stringify(report.consoleErrors.slice(0, 5))} pageErrors: ${JSON.stringify(report.pageErrors.slice(0, 5))}`);
    }
  });

  await browser.close();
} catch (err) {
  try {
    if (browser) for (const pg of (await browser.contexts()).flatMap((c) => c.pages())) {
      await pg.screenshot({ path: path.join(artifacts, "wizard-99-failure.png") }).catch(() => {});
    }
  } catch { /* best effort */ }
  if (browser) await browser.close().catch(() => {});
} finally {
  cleanup();
  fs.writeFileSync(path.join(artifacts, "wizard-report.json"), JSON.stringify(report, null, 2));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* engine may hold handles briefly */ }
}

log(`report: ${path.join(artifacts, "wizard-report.json")}`);
const failed = report.steps.filter((s) => !s.ok);
if (failed.length || report.consoleErrors.length || report.pageErrors.length) {
  log(`${failed.length} fehlgeschlagene Schritte, ${report.consoleErrors.length} Console-Fehler, ${report.pageErrors.length} Page-Fehler`);
  process.exit(1);
}
log("Wizard-Drive komplett grün");
