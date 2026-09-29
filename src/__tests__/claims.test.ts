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
  it("a claim saved from a chat message anchors citations to the latest version with pages only when truly known", async () => {
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
        { sourceId, chunkIndex: 0, text: "Die Frist beträgt drei Monate." },
        { sourceId: srcNoVersion, chunkIndex: 1, text: "Nie versioniertes Zitat" },
        { sourceId, chunkIndex: 2, text: "anderer Inhalt" },
      ],
    });

    const saved = await saveClaimFromMessage(ctx.db, { notebookId, messageId, text: "Die Frist beträgt drei Monate." });

    expect(saved.anchorCount).toBe(2); // both citable sources have versions
    expect(saved.unresolved).toEqual([{ sourceId: srcNoVersion, reason: "no version recorded" }]);

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
        quote: "Originalfassung mit dem Kernsatz",
        storageId: storedV1.id,
        absolutePath: expect.stringContaining(storedV1.id),
      },
    });
  });
});
