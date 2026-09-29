// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { closeLocalDb } from "@/db/local";
import { getLocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource } from "@/lib/services/sources";
import { createMessage } from "@/lib/services/messages";
import { recordVersion } from "@/lib/services/source-versions";
import { createClaim, saveClaimFromMessage, listClaims } from "@/lib/services/claims";

let dir: string;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-claims-"));
  process.env.NOTELM_DATA_DIR = dir;
  const ctx = getLocalContext();
  notebookId = await createNotebook(ctx.db, { ownerId: "local", title: "Behauptungen" });
});

afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db); // releases WAL locks on Windows
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A persisted source row to hang versions and claims off. */
async function makeSource(fileName: string): Promise<string> {
  const { db } = getLocalContext();
  return createSource(db, {
    ownerId: "local",
    notebookId,
    fileName,
    fileType: "text/plain",
    fileSize: 100,
  });
}

describe("claims & evidence anchors (open-source-innovation-strategy 5A/5B)", () => {
  it("a claim saved from a chat message anchors stamped citations to their retrieval-time version with pages only when truly known", async () => {
    const ctx = getLocalContext();
    const sourceId = await makeSource("gutachten.txt");
    const v1 = await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Kapitel eins: Die Frist beträgt drei Monate.", "Kapitel zwei: anderer Inhalt."],
    });

    const srcNoVersion = await makeSource("roh.txt"); // never versioned

    const messageId = await createMessage(ctx.db, {
      ownerId: "local",
      notebookId,
      role: "assistant",
      content: "Die Frist beträgt drei Monate [1].",
      citations: [
        { sourceId, chunkIndex: 0, text: "Die Frist beträgt drei Monate.", sourceVersionId: v1.id },
        { sourceId: srcNoVersion, chunkIndex: 1, text: "Nie versioniertes Zitat", fileName: "roh.txt" },
        { sourceId, chunkIndex: 2, text: "anderer Inhalt", sourceVersionId: v1.id },
      ],
    });

    const saved = await saveClaimFromMessage(ctx.db, { notebookId, messageId, text: "Die Frist beträgt drei Monate." });

    expect(saved.anchorCount).toBe(2); // both stamped citations anchor to v1
    // the unstamped citation is never defaulted to latest: honest unresolved reference
    expect(saved.unresolvedReferences).toEqual([
      { sourceId: srcNoVersion, fileName: "roh.txt", quote: "Nie versioniertes Zitat" },
    ]);

    const [row] = listClaims(ctx.db, notebookId);
    expect(row).toMatchObject({
      text: "Die Frist beträgt drei Monate.",
      origin: "chat",
      status: "active",
      pendingReviews: 0,
    });
    expect(row.originMessageId).toBe(messageId);
    expect(row.anchors).toHaveLength(2);
    expect(row.anchors[0]).toMatchObject({
      fileName: "gutachten.txt",
      version: 1,
      page: null, // citations carry no page -> stored as null, never invented
      quote: "Die Frist beträgt drei Monate.",
    });
    expect(row.anchors[0].sourceVersionId).toBe(v1.id);

    // explicit pages from the saver are kept; absent ones stay null
    const manual = await createClaim(ctx.db, {
      notebookId,
      ownerId: "local",
      text: "Manuell gesicherte Behauptung",
      origin: "user",
      anchors: [
        { sourceId, page: 2, quote: "anderer Inhalt" },
        { sourceId }, // no page, no quote -> honest nulls
      ],
    });
    expect(manual.anchorCount).toBe(2);
    expect(manual.unresolved).toEqual([]);
    const manualRow = listClaims(ctx.db, notebookId).find((c) => c._id === manual.id)!;
    expect(manualRow.origin).toBe("user");
    const pages = manualRow.anchors.map((a) => a.page).sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
    expect(pages).toEqual([2, null]);
    expect([...manualRow.anchors.map((a) => a.quote)].sort()).toEqual(["", "anderer Inhalt"]);
  });

  it("anchors survive source re-import - they still resolve to the OLD version bytes", async () => {
    const ctx = getLocalContext();
    const sourceId = await makeSource("vertrag.txt");
    const storedV1 = await ctx.store.save(Buffer.from("Originalfassung mit dem Kernsatz"), { fileName: "vertrag.txt", contentType: "text/plain" });
    const v1 = await recordVersion(ctx.db, ctx.store, { sourceId, storageId: storedV1.id, pageTexts: ["Originalfassung mit dem Kernsatz"] });

    const claim = await createClaim(ctx.db, {
      notebookId,
      ownerId: "local",
      text: "Der Kernsatz steht so im Vertrag.",
      origin: "user",
      anchors: [{ sourceId, quote: "Originalfassung mit dem Kernsatz" }],
    });
    const anchorId = listClaims(ctx.db, notebookId).find((c) => c._id === claim.id)!.anchors[0].id;

    // changed bytes append v2; the anchor row is NOT moved by the scan
    const storedV2 = await ctx.store.save(Buffer.from("Geänderte Fassung ohne den Kernsatz"), { fileName: "vertrag.txt", contentType: "text/plain" });
    const v2 = await recordVersion(ctx.db, ctx.store, { sourceId, storageId: storedV2.id, pageTexts: ["Geänderte Fassung ohne den Kernsatz"] });
    expect(v2.version).toBe(2);

    const anchor = listClaims(ctx.db, notebookId).find((c) => c._id === claim.id)!.anchors[0];
    expect(anchor.sourceVersionId).toBe(v1.id);
    expect(anchor.version).toBe(1);

    // evidence.open still resolves the OLD version's stored bytes
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const opened = await handleEngineRequest("evidence.open", { anchorId });
    expect(opened).toEqual({
      ok: true,
      result: {
        fileName: "vertrag.txt",
        page: null,
        locator: null, // time-range anchors only - a text anchor has none
        quote: "Originalfassung mit dem Kernsatz",
        storageId: storedV1.id,
        absolutePath: expect.stringContaining(storedV1.id),
      },
    });
  });
});

describe("claim provenance (priority-1 fix: old messages keep the version the answer used)", () => {
  it("a claim saved from an old message keeps the version the answer actually used", async () => {
    const ctx = getLocalContext();
    const sourceId = await makeSource("gutachten.txt");
    const storedV1 = await ctx.store.save(Buffer.from("Die Frist beträgt drei Monate."), {
      fileName: "gutachten.txt",
      contentType: "text/plain",
    });
    const v1 = await recordVersion(ctx.db, ctx.store, {
      sourceId,
      storageId: storedV1.id,
      pageTexts: ["Die Frist beträgt drei Monate."],
    });

    // retrieval reads chunks, so the source needs them (fts mode, no embedder)
    const { replaceChunks, updateSourceStatus } = await import("@/lib/services/sources");
    const { sendChatMessage } = await import("@/lib/services/chat");
    const { listMessagesByNotebook } = await import("@/lib/services/messages");
    replaceChunks(ctx.db, { ownerId: "local", sourceId, notebookId }, ["Die Frist beträgt drei Monate."]);
    await updateSourceStatus(ctx.db, sourceId, { status: "completed" });

    // the answer is produced against v1; its citations are stamped v1 at
    // retrieval time
    const reply = await sendChatMessage(ctx.db, {
      notebookId,
      ownerId: "local",
      message: "Wie lang ist die Frist?",
      chat: async () => ({ text: "Die Frist beträgt drei Monate [E1].", provider: "test", model: "test" }),
      embedQuery: null,
      store: ctx.store,
    });
    expect(reply.citations).toHaveLength(1);
    expect(reply.citations[0].sourceVersionId).toBe(v1.id);

    // the re-import lands AFTER the answer (the "re-import during generation"
    // race is covered by the retrieval-time stamp: the message above already
    // carries v1 ids before the following recordVersion call runs)
    const storedV2 = await ctx.store.save(Buffer.from("Die Frist beträgt drei Wochen."), {
      fileName: "gutachten.txt",
      contentType: "text/plain",
    });
    const v2 = await recordVersion(ctx.db, ctx.store, {
      sourceId,
      storageId: storedV2.id,
      pageTexts: ["Die Frist beträgt drei Wochen."],
    });
    expect(v2.version).toBe(2);

    // NOW the old (v1-based) answer is saved as a claim
    const [assistant] = (await listMessagesByNotebook(ctx.db, notebookId)).filter(
      (m) => m.role === "assistant"
    );
    const saved = await saveClaimFromMessage(ctx.db, {
      notebookId,
      messageId: assistant!._id,
      text: "Die Frist beträgt drei Monate.",
    });

    expect(saved.anchorCount).toBe(1);
    expect(saved.unresolvedReferences).toEqual([]);
    const anchor = listClaims(ctx.db, notebookId)[0].anchors[0];
    expect(anchor.sourceVersionId).toBe(v1.id);
    expect(anchor.version).toBe(1); // never rewound/forwarded to v2

    // evidence.open resolves the v1 bytes the answer was really built from
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const opened = await handleEngineRequest("evidence.open", { anchorId: anchor.id });
    expect(opened).toEqual({
      ok: true,
      result: {
        fileName: "gutachten.txt",
        page: null,
        locator: null,
        quote: "Die Frist beträgt drei Monate.",
        storageId: storedV1.id,
        absolutePath: expect.stringContaining(storedV1.id),
      },
    });
  });

  it("a legacy message without version stamps yields an unresolved reference, never v2", async () => {
    const ctx = getLocalContext();
    const sourceId = await makeSource("vertrag.txt");
    await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Originalsatz der ersten Fassung."],
    });
    const v2 = await recordVersion(ctx.db, ctx.store, {
      sourceId,
      pageTexts: ["Komplett neuer Inhalt der zweiten Fassung."],
    });
    expect(v2.version).toBe(2);

    // crafted exactly like a message persisted before the provenance fix
    const messageId = await createMessage(ctx.db, {
      ownerId: "local",
      notebookId,
      role: "assistant",
      content: "Originalsatz [1]",
      citations: [{ sourceId, chunkIndex: 0, text: "Originalsatz der ersten Fassung.", fileName: "vertrag.txt" }],
    });

    const saved = await saveClaimFromMessage(ctx.db, {
      notebookId,
      messageId,
      text: "Der Originalsatz steht so im Vertrag.",
    });

    // never defaulted to latest (v2): honest unresolved reference instead
    expect(saved.anchorCount).toBe(0);
    expect(saved.unresolvedReferences).toEqual([
      { sourceId, fileName: "vertrag.txt", quote: "Originalsatz der ersten Fassung." },
    ]);
    // the claim row exists but carries no anchor: nothing was fabricated
    const [claimRow] = listClaims(ctx.db, notebookId);
    expect(claimRow.anchors).toHaveLength(0);
    expect(claimRow.pendingReviews).toBe(0);
  });
});
