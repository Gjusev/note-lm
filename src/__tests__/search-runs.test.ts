// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { searchRuns } from "@/db/local/schema";
import { recordSearchRun, latestSearchCovering } from "@/lib/services/search-runs";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-search-runs-"));
  process.env.NOTELM_DATA_DIR = dir;
});

afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db); // releases WAL locks on Windows
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A completed source with real chunks (the FTS branch needs them). */
async function seedChunks(notebookId: string, fileName: string, contents: string[]): Promise<string> {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { db } = getLocalContext();
  const { createSource, replaceChunks, updateSourceStatus } = await import("@/lib/services/sources");
  const sourceId = await createSource(db, {
    ownerId: "local", notebookId, fileName, fileType: "text/plain", fileSize: 10,
  });
  replaceChunks(db, { ownerId: "local", sourceId, notebookId }, contents);
  await updateSourceStatus(db, sourceId, { status: "completed" });
  return sourceId;
}

describe("search-runs service (migration 0014 provenance store)", () => {
  it("recordSearchRun stores the full recipe; latestSearchCovering reads it back", async () => {
    const { getLocalContext } = await import("@/lib/storage/local");
    const { db } = getLocalContext();
    const { createNotebook } = await import("@/lib/services/notebooks");
    const notebookId = await createNotebook(db, { ownerId: "local", title: "Provenanz" });
    const sourceId = await seedChunks(notebookId, "kaffee.txt", ["Dosierung alpha"]);

    const runId = recordSearchRun(db, {
      ownerId: "local",
      notebookId,
      query: "Dosierung",
      sourceIds: [sourceId],
      profileId: null,
      fusionPolicy: "protected-vector",
      resultCount: 1,
      resultChunkIds: ["chunk-1"],
    });
    expect(runId).toBeTruthy();

    const run = latestSearchCovering(db, notebookId, sourceId)!;
    expect(run).toMatchObject({
      id: runId,
      notebookId,
      query: "Dosierung",
      sourceIds: [sourceId],
      profileId: null,
      fusionPolicy: "protected-vector",
      resultCount: 1,
      resultChunkIds: ["chunk-1"],
      createdAt: expect.any(Number),
    });
  });

  it("latestSearchCovering returns the MOST RECENT covering run; a newer non-covering run never supersedes it", async () => {
    const { getLocalContext } = await import("@/lib/storage/local");
    const { db } = getLocalContext();
    const { createNotebook } = await import("@/lib/services/notebooks");
    const notebookId = await createNotebook(db, { ownerId: "local", title: "Rekursion" });
    const kaffee = await seedChunks(notebookId, "kaffee.txt", ["alpha"]);
    const bericht = await seedChunks(notebookId, "bericht.txt", ["beta"]);

    // run 1 covers BOTH sources, then ages a minute (same-ms writes would
    // make "most recent" ambiguous — the update simulates time passing)
    const run1 = recordSearchRun(db, {
      ownerId: "local", notebookId, query: "alte Suche",
      sourceIds: [kaffee, bericht], resultCount: 0, resultChunkIds: [],
    });
    db.update(searchRuns)
      .set({ createdAt: Date.now() - 60_000 })
      .where(eq(searchRuns.id, run1))
      .run();
    // run 2 is NEWER but covers only the bericht source
    recordSearchRun(db, {
      ownerId: "local", notebookId, query: "neuere Suche",
      sourceIds: [bericht], resultCount: 0, resultChunkIds: [],
    });

    expect(latestSearchCovering(db, notebookId, kaffee)!.query).toBe("alte Suche");
    expect(latestSearchCovering(db, notebookId, bericht)!.query).toBe("neuere Suche");

    // a run covering kaffee that is newer still takes over
    recordSearchRun(db, {
      ownerId: "local", notebookId, query: "neueste Suche",
      sourceIds: [kaffee], resultCount: 0, resultChunkIds: [],
    });
    expect(latestSearchCovering(db, notebookId, kaffee)!.query).toBe("neueste Suche");
  });

  it("returns null when no recorded run covers the source (scope rule + notebook scoping)", async () => {
    const { getLocalContext } = await import("@/lib/storage/local");
    const { db } = getLocalContext();
    const { createNotebook } = await import("@/lib/services/notebooks");
    const notebookId = await createNotebook(db, { ownerId: "local", title: "Ohne" });
    const otherNotebookId = await createNotebook(db, { ownerId: "local", title: "Fremd" });
    const kaffee = await seedChunks(notebookId, "kaffee.txt", ["alpha"]);
    const bericht = await seedChunks(notebookId, "bericht.txt", ["beta"]);

    // a run exists, but its scope covers only the kaffee source
    recordSearchRun(db, {
      ownerId: "local", notebookId, query: "irgendetwas",
      sourceIds: [kaffee], resultCount: 0, resultChunkIds: [],
    });
    expect(latestSearchCovering(db, notebookId, bericht)).toBeNull();
    // notebook scoping: the same source asked from another notebook finds nothing
    expect(latestSearchCovering(db, otherNotebookId, kaffee)).toBeNull();
  });
});

describe("search.run op (performed search with provenance)", () => {
  it("records the run and returns hits + runId (dispatch roundtrip)", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const { getLocalContext } = await import("@/lib/storage/local");
    const { getChunksBySource } = await import("@/lib/services/sources");

    const nb = await handleEngineRequest("notebooks.create", { title: "Suche" });
    const notebookId = (nb as { result: { id: string } }).result.id;
    const kaffee = await seedChunks(notebookId, "kaffee.txt", ["Die Dosierung ist im untersuchten Bereich wirksam."]);

    const res = await handleEngineRequest("search.run", { notebookId, query: "Dosierung" });
    expect(res.ok).toBe(true);
    const result = (res as { result: {
      runId: string; sourceIds: string[]; mode: string; vectorStatus: string;
      hits: { chunkId: string; sourceId: string; content: string }[];
    } }).result;
    expect(result.runId).toBeTruthy();
    // no embed capability in tests: the honest FTS fallback, typed
    expect(result.mode).toBe("fts");
    expect(result.vectorStatus).toBe("unavailable");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].content).toContain("Dosierung");
    expect(result.hits[0].chunkId).toBe(getChunksBySource(getLocalContext().db, kaffee)[0]._id);
    // unscoped search: the recorded scope is every source of the notebook
    expect(result.sourceIds).toEqual([kaffee]);

    // the recorded run IS the provenance a later matrix cell will name
    const { db } = getLocalContext();
    const run = latestSearchCovering(db, notebookId, kaffee)!;
    expect(run.query).toBe("Dosierung");
    expect(run.fusionPolicy).toBe("protected-vector");
    expect(run.profileId).toBeNull();
    expect(run.resultCount).toBe(1);
    expect(run.resultChunkIds).toEqual([result.hits[0].chunkId]);
  });

  it("respects the source selection and never returns other-notebook chunks", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const { getLocalContext } = await import("@/lib/storage/local");
    const { createNotebook } = await import("@/lib/services/notebooks");

    const nb = await handleEngineRequest("notebooks.create", { title: "Scope" });
    const notebookId = (nb as { result: { id: string } }).result.id;
    const otherNotebookId = await createNotebook(getLocalContext().db, { ownerId: "local", title: "Fremd" });

    const kaffee = await seedChunks(notebookId, "kaffee.txt", ["alpha Dosierung"]);
    const bericht = await seedChunks(notebookId, "bericht.txt", ["alpha Nebenwirkungen"]);
    await seedChunks(otherNotebookId, "fremd.txt", ["alpha ganz privat"]);

    const res = await handleEngineRequest("search.run", {
      notebookId, query: "alpha", sourceIds: [kaffee],
    });
    expect(res.ok).toBe(true);
    const { hits, sourceIds } = (res as { result: {
      hits: { sourceId: string; content: string }[]; sourceIds: string[];
    } }).result;
    // the selection is respected: only the kaffee chunk, never the bericht
    // chunk that matches equally, and never the other notebook's chunk
    expect(hits).toHaveLength(1);
    expect(hits[0].sourceId).toBe(kaffee);
    expect(hits.some((h) => h.content.includes("privat"))).toBe(false);
    expect(sourceIds).toEqual([kaffee]);

    // provenance follows the selection: the bericht source was NOT covered
    const { db } = getLocalContext();
    expect(latestSearchCovering(db, notebookId, bericht)).toBeNull();
    expect(latestSearchCovering(db, notebookId, kaffee)!.sourceIds).toEqual([kaffee]);
  });

  it("answers bad args with typed German errors", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const nb = await handleEngineRequest("notebooks.create", { title: "Fehler" });
    const notebookId = (nb as { result: { id: string } }).result.id;

    const noQuery = await handleEngineRequest("search.run", { notebookId });
    expect(noQuery).toEqual({
      ok: false,
      error: { code: "bad_args", message: "notebookId und query sind erforderlich." },
    });
    const badIds = await handleEngineRequest("search.run", { notebookId, query: "x", sourceIds: "kaffee.txt" });
    expect(badIds).toEqual({
      ok: false,
      error: { code: "bad_args", message: "sourceIds muss ein Array aus Quellen-IDs sein." },
    });
  });
});
