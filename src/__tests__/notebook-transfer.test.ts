// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { LocalStore } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks, updateSourceStatus } from "@/lib/services/sources";
import { createMessage } from "@/lib/services/messages";
import { createNote } from "@/lib/services/notes";
import { exportNotebook, importNotebook } from "@/lib/services/notebook-transfer";

let dir: string;
let db: LocalDb;
let store: LocalStore;
let exportDir: string;
let restoreDir: string;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-xfer-"));
  db = openLocalDb(dir);
  store = new LocalStore(db, dir);
  exportDir = path.join(dir, "export");
  restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-xfer-restore-"));

  notebookId = await createNotebook(db, { ownerId: "local", title: "Export Buch" });
  const sourceId = await createSource(db, {
    ownerId: "local", notebookId, fileName: "doc.txt", fileType: "text/plain", fileSize: 10,
  });
  replaceChunks(db, { ownerId: "local", sourceId, notebookId }, ["Zitronenbaum Inhalt"]);
  await updateSourceStatus(db, sourceId, { status: "completed" });
  await createMessage(db, {
    ownerId: "local", notebookId, role: "assistant", content: "Antwort [1].",
    citations: [{ sourceId, chunkIndex: 0, text: "Zitronenbaum Inhalt" }],
  });
  await createNote(db, { ownerId: "local", notebookId, title: "N", content: "C" });
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
});

describe("notebook export/restore (phase 6)", () => {
  it("roundtrips a notebook with citations, notes and file bytes intact", async () => {
    // attach an original file to the source so bytes travel too
    const { updateSourceStatus: upd } = await import("@/lib/services/sources");
    const file = await store.save(Buffer.from("original bytes"), {
      fileName: "doc.txt", contentType: "text/plain",
    });
    await upd(db, (await import("@/lib/services/sources")).listSourcesByNotebook(db, notebookId)[0]._id, {
      status: "completed", transcriptStorageId: file.id,
    });

    const exported = await exportNotebook(db, store, notebookId, exportDir);
    expect(exported.documents).toBe(1);
    expect(exported.files).toBe(1);
    expect(fs.existsSync(path.join(exportDir, "notebook.json"))).toBe(true);

    // restore into a FRESH data dir
    const db2 = openLocalDb(restoreDir);
    const store2 = new LocalStore(db2, restoreDir);
    const restored = await importNotebook(db2, store2, exportDir);
    expect(restored.notebookId).toBe(notebookId);
    expect(restored.documents).toBe(1);
    expect(restored.messagesWithCitations).toBe(1);

    const { listMessagesByNotebook } = await import("@/lib/services/messages");
    const messages = await listMessagesByNotebook(db2, notebookId);
    expect(messages[0].citations?.[0].text).toBe("Zitronenbaum Inhalt");
    const { listNotesByNotebook } = await import("@/lib/services/notes");
    expect((await listNotesByNotebook(db2, notebookId))[0].title).toBe("N");
    // file bytes came across and resolve through the store
    const read = await store2.read(file.id);
    expect(read?.buffer.toString()).toBe("original bytes");

    // restoring the same export twice into the same db fails loudly
    await expect(importNotebook(db2, store2, exportDir)).rejects.toThrow(/existiert bereits/);
    closeLocalDb(db2);
  });
});
