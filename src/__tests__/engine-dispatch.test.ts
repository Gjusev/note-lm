import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-dispatch-"));
  process.env.NOTELM_DATA_DIR = dir;
});

afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db); // releases WAL locks on Windows
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("engine dispatch (issue #10 seam: ops without HTTP)", () => {
  it("answers unknown operations with a typed error, not a crash", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const res = await handleEngineRequest("nope", {});
    expect(res).toEqual({
      ok: false,
      error: { code: "unknown_op", message: expect.stringContaining("nope") },
    });
  });

  it("handshakes with the protocol version", async () => {
    const { handleEngineRequest, PROTOCOL_VERSION } = await import("@/engine/dispatch");
    const res = await handleEngineRequest("protocol.version", {});
    expect(res).toEqual({ ok: true, result: { version: PROTOCOL_VERSION } });
  });

  it("lists and creates notebooks through the local services", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");

    const created = await handleEngineRequest("notebooks.create", { title: "Engine Book" });
    expect(created.ok).toBe(true);
    const id = (created as { result: { id: string } }).result.id;
    expect(id).toBeTruthy();

    const listed = await handleEngineRequest("notebooks.list", {});
    expect(listed.ok).toBe(true);
    const notebooks = (listed as { result: Array<{ _id: string; title: string }> }).result;
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0]._id).toBe(id);
    expect(notebooks[0].title).toBe("Engine Book");
  });

  it("manages notes within a notebook", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const nb = await handleEngineRequest("notebooks.create", { title: "Notes Book" });
    const notebookId = (nb as { result: { id: string } }).result.id;

    const created = await handleEngineRequest("notes.create", {
      notebookId, title: "First", content: "engine note body",
    });
    expect(created.ok).toBe(true);
    const noteId = (created as { result: { id: string } }).result.id;

    const updated = await handleEngineRequest("notes.update", {
      noteId, title: "First!", content: "changed",
    });
    expect(updated.ok).toBe(true);

    const listed = await handleEngineRequest("notes.list", { notebookId });
    const notes = (listed as { result: Array<{ _id: string; title: string; content: string }> }).result;
    expect(notes).toHaveLength(1);
    expect(notes[0]._id).toBe(noteId);
    expect(notes[0].title).toBe("First!");
    expect(notes[0].content).toBe("changed");

    const deleted = await handleEngineRequest("notes.delete", { noteId });
    expect(deleted.ok).toBe(true);
    const after = await handleEngineRequest("notes.list", { notebookId });
    expect((after as { result: unknown[] }).result).toHaveLength(0);
  });

  it("serves sources and their chunks", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const { getLocalContext } = await import("@/lib/storage/local");
    const { createSource, replaceChunks } = await import("@/lib/services/sources");

    const nb = await handleEngineRequest("notebooks.create", { title: "Sources Book" });
    const notebookId = (nb as { result: { id: string } }).result.id;

    const { db } = getLocalContext();
    const sourceId = await createSource(db, {
      ownerId: "local", notebookId, fileName: "paper.txt", fileType: "text/plain", fileSize: 30,
    });
    replaceChunks(db, { ownerId: "local", sourceId, notebookId }, ["alpha content", "beta content"]);

    const listed = await handleEngineRequest("sources.list", { notebookId });
    const sources = (listed as { result: Array<{ _id: string; fileName: string }> }).result;
    expect(sources).toHaveLength(1);
    expect(sources[0]._id).toBe(sourceId);
    expect(sources[0].fileName).toBe("paper.txt");

    const one = await handleEngineRequest("sources.get", { sourceId });
    expect((one as { result: { _id: string } }).result._id).toBe(sourceId);

    const chunks = await handleEngineRequest("sources.chunks", { sourceId });
    expect((chunks as { result: Array<{ content: string }> }).result.map((c) => c.content))
      .toEqual(["alpha content", "beta content"]);

    const deleted = await handleEngineRequest("sources.delete", { sourceId });
    expect(deleted.ok).toBe(true);
    const after = await handleEngineRequest("sources.list", { notebookId });
    expect((after as { result: unknown[] }).result).toHaveLength(0);
  });

  it("serves chat messages, learning materials and import jobs", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const nb = await handleEngineRequest("notebooks.create", { title: "Chat Book" });
    const notebookId = (nb as { result: { id: string } }).result.id;

    // messages
    const msg = await handleEngineRequest("messages.create", {
      notebookId, role: "user", content: "Frage?",
    });
    expect(msg.ok).toBe(true);
    const messages = await handleEngineRequest("messages.list", { notebookId });
    expect((messages as { result: Array<{ content: string }> }).result).toHaveLength(1);
    expect((messages as { result: Array<{ content: string }> }).result[0].content).toBe("Frage?");

    const cleared = await handleEngineRequest("messages.clear", { notebookId });
    expect(cleared.ok).toBe(true);
    const empty = await handleEngineRequest("messages.list", { notebookId });
    expect((empty as { result: unknown[] }).result).toHaveLength(0);

    // materials
    const requested = await handleEngineRequest("materials.request", {
      notebookId, type: "summary",
    });
    expect(requested.ok).toBe(true);
    const materialId = (requested as { result: { id: string } }).result.id;
    const materials = await handleEngineRequest("materials.list", { notebookId });
    expect((materials as { result: Array<{ _id: string; type: string }> }).result).toHaveLength(1);
    expect((materials as { result: Array<{ _id: string; type: string }> }).result[0].type).toBe("summary");
    const materialDeleted = await handleEngineRequest("materials.delete", { materialId });
    expect(materialDeleted.ok).toBe(true);

    // imports
    const enqueued = await handleEngineRequest("imports.create", {
      notebookId, url: "https://example.com/article",
    });
    expect(enqueued.ok).toBe(true);
    const jobId = (enqueued as { result: { jobId: string } }).result.jobId;
    const jobs = await handleEngineRequest("imports.list", { notebookId });
    expect((jobs as { result: Array<{ _id: string; provider: string }> }).result).toHaveLength(1);
    expect((jobs as { result: Array<{ _id: string }> }).result[0]._id).toBe(jobId);
    const cancelled = await handleEngineRequest("imports.action", { jobId, action: "cancel" });
    expect(cancelled.ok).toBe(true);
  });

  it("jobs.eventsSince returns the events plus the next cursor for the UI reconnect", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const nb = await handleEngineRequest("notebooks.create", { title: "Event Book" });
    const notebookId = (nb as { result: { id: string } }).result.id;
    const created = await handleEngineRequest("imports.create", {
      notebookId, url: "https://x.test/events",
    });
    const jobId = (created as { result: { jobId: string } }).result.jobId;
    const paused = await handleEngineRequest("jobs.pause", { kind: "import", jobId }); // emits intent.pause
    expect(paused.ok).toBe(true);

    const page = (await handleEngineRequest("jobs.eventsSince", { cursor: 0 })) as {
      ok: boolean;
      result: { events: Array<{ seq: number; type: string }>; cursor: number };
    };
    expect(page.ok).toBe(true);
    expect(page.result.events.length).toBeGreaterThan(0);
    // max seq rides along so the UI knows its next read offset
    expect(page.result.cursor).toBe(page.result.events.at(-1)!.seq);

    // already at the head: no new events and the cursor stays parked there
    const head = (await handleEngineRequest("jobs.eventsSince", { cursor: page.result.cursor })) as {
      ok: boolean;
      result: { events: unknown[]; cursor: number };
    };
    expect(head.result.events).toHaveLength(0);
    expect(head.result.cursor).toBe(page.result.cursor);
  });

  it("activates and reports the embedding profile for retrieval", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");

    // nothing active by default
    const none = await handleEngineRequest("retrieval.profile.active", {});
    expect(none).toEqual({ ok: true, result: { profile: null } });

    const activated = await handleEngineRequest("retrieval.profile.activate", {
      provider: "llamacpp",
      model: "bge-small-en-v1.5",
      revision: "q8_0",
      dimension: 384,
      pooling: "mean",
    });
    expect(activated.ok).toBe(true);
    const profileId = (activated as { result: { profileId: string } }).result.profileId;
    expect(profileId).toBeTruthy();

    const active = await handleEngineRequest("retrieval.profile.active", {});
    expect((active as { result: { profile: { _id: string; dimension: number } } }).result.profile).toMatchObject({
      _id: profileId,
      dimension: 384,
    });

    // re-activating the same natural key is idempotent
    const again = await handleEngineRequest("retrieval.profile.activate", {
      provider: "llamacpp",
      model: "bge-small-en-v1.5",
      revision: "q8_0",
      dimension: 384,
      pooling: "mean",
    });
    expect((again as { result: { profileId: string } }).result.profileId).toBe(profileId);
  });

  it("pauses and resumes the global scheduler through the engine (close/tray slice)", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const { getLocalContext } = await import("@/lib/storage/local");
    const { getSetting } = await import("@/lib/services/settings");
    const { db } = getLocalContext();

    // default: running, and jobs.list reports the scheduler state alongside
    let listed = await handleEngineRequest("jobs.list", {});
    expect((listed as { result: { schedulerPaused: boolean } }).result.schedulerPaused).toBe(false);

    const paused = await handleEngineRequest("scheduler.pause", {});
    expect(paused).toEqual({ ok: true, result: { paused: true } });
    expect(await getSetting<boolean>(db, "scheduler.paused")).toBe(true);

    listed = await handleEngineRequest("jobs.list", {});
    expect((listed as { result: { schedulerPaused: boolean } }).result.schedulerPaused).toBe(true);

    const resumed = await handleEngineRequest("scheduler.resume", {});
    expect(resumed).toEqual({ ok: true, result: { paused: false } });
    expect(await getSetting<boolean>(db, "scheduler.paused")).toBe(false);
  });

  it("reports diagnostics: vec extension version and provider configuration", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const res = await handleEngineRequest("diagnostics.capabilities", {});
    expect(res.ok).toBe(true);
    const result = (res as { result: { vecVersion: string | null; localChatConfigured: boolean; localEmbedConfigured: boolean } }).result;
    // the extension is a dependency of this repo — it must be loaded
    expect(result.vecVersion).toMatch(/^v?\d+\.\d+/);
    expect(typeof result.localChatConfigured).toBe("boolean");
    expect(typeof result.localEmbedConfigured).toBe("boolean");
  });

  it("claims and review roundtrip through the engine ops", async () => {
    const { handleEngineRequest } = await import("@/engine/dispatch");
    const { getLocalContext } = await import("@/lib/storage/local");
    const { createSource } = await import("@/lib/services/sources");
    const { createMessage } = await import("@/lib/services/messages");
    const { recordVersion } = await import("@/lib/services/source-versions");

    const nb = await handleEngineRequest("notebooks.create", { title: "Claims Book" });
    const notebookId = (nb as { result: { id: string } }).result.id;
    const { db, store } = getLocalContext();

    // validation: text is required
    const bad = await handleEngineRequest("claims.create", { notebookId });
    expect(bad).toEqual({ ok: false, error: { code: "bad_args", message: expect.any(String) } });

    const sourceId = await createSource(db, {
      ownerId: "local", notebookId, fileName: "fundstelle.txt", fileType: "text/plain", fileSize: 50,
    });
    await recordVersion(db, store, { sourceId, pageTexts: ["Fundstelle auf der ersten Seite."] });

    const messageId = await createMessage(db, {
      ownerId: "local", notebookId, role: "assistant", content: "Antwort [1]",
      citations: [{ sourceId, chunkIndex: 0, text: "Fundstelle auf der ersten Seite." }],
    });
    const created = await handleEngineRequest("claims.createFromMessage", {
      notebookId, messageId, text: "Die Fundstelle steht auf Seite eins.",
    });
    expect(created.ok).toBe(true);

    // changing the source fires the deterministic staleness scan
    await recordVersion(db, store, {
      sourceId, pageTexts: ["Neue erste Seite.", "Fundstelle auf der ersten Seite."],
    });

    const reviews = await handleEngineRequest("review.list", { notebookId });
    const proposals = (reviews as { result: Array<{ id: string; reason: string }> }).result;
    expect(proposals).toHaveLength(1);
    expect(proposals[0].reason).toBe("quote_moved");

    const resolved = await handleEngineRequest("review.resolve", {
      proposalId: proposals[0].id, decision: "accepted",
    });
    expect(resolved.ok).toBe(true);

    const claims = await handleEngineRequest("claims.list", { notebookId });
    const [claim] = (claims as { result: Array<{ status: string; anchors: Array<{ id: string; version: number; page: number | null }> }> }).result;
    expect(claim.status).toBe("reviewed");
    expect(claim.anchors[0]).toMatchObject({ version: 2, page: 2 });

    const opened = await handleEngineRequest("evidence.open", { anchorId: claim.anchors[0].id });
    expect((opened as { result: { page: number | null } }).result.page).toBe(2);

    const after = await handleEngineRequest("review.list", { notebookId });
    expect((after as { result: unknown[] }).result).toHaveLength(0);
  });
});
