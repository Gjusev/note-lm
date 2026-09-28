// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks, updateSourceStatus } from "@/lib/services/sources";
import { listMessagesByNotebook } from "@/lib/services/messages";
import { registerEmbeddingProfile } from "@/lib/services/embedding-profiles";
import { ensureVecTable, insertVector } from "@/lib/services/vector-index";
import { setSetting } from "@/lib/services/settings";
import { sendChatMessage } from "@/lib/services/chat";

let dir: string;
let db: LocalDb;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-chat-"));
  db = openLocalDb(dir);
  notebookId = await createNotebook(db, { ownerId: "local", title: "Chat" });
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Deterministic embedder: "gamma" near axis 0, everything else axis 1. */
const embedQuery = (q: string): Buffer => {
  const v = new Float32Array(8);
  v[q.includes("gamma") ? 0 : 1] = 1;
  return Buffer.from(v.buffer);
};

async function seedProfileWithVector(content: string): Promise<void> {
  const profile = await registerEmbeddingProfile(db, {
    provider: "test", model: "axis", revision: "1", dimension: 8, pooling: "mean",
  });
  await setSetting(db, "retrieval.activeProfile", profile._id);
  ensureVecTable(db, profile._id, 8);
  const source = await createSource(db, {
    ownerId: "local", notebookId, fileName: "g.txt", fileType: "text/plain", fileSize: content.length,
  });
  replaceChunks(db, { ownerId: "local", sourceId: source, notebookId }, [content]);
  await updateSourceStatus(db, source, { status: "completed" });
  const { getChunksBySource } = await import("@/lib/services/sources");
  const chunk = getChunksBySource(db, source)[0];
  insertVector(db, profile._id, chunk._id, notebookId, embedQuery(content), source);
}

describe("chat service (phase 2 — transport independent)", () => {
  it("answers from evidence with [E1] references and persists citations", async () => {
    await seedProfileWithVector("gamma rays are electromagnetic radiation");

    const seen: string[] = [];
    const reply = await sendChatMessage(db, {
      notebookId,
      ownerId: "local",
      message: "Was sind Gammastrahlen?",
      chat: async (messages) => {
        seen.push(messages.map((m) => m.content).join("\n"));
        return "Gammastrahlen sind elektromagnetische Strahlung [E1].";
      },
      embedQuery,
    });

    expect(reply.mode).toBe("hybrid"); // active profile + embedder → hybrid
    expect(reply.citations).toHaveLength(1);
    expect(reply.citations[0].text).toContain("gamma rays");
    expect(seen[0]).toContain("gamma rays"); // the excerpt was actually sent

    const stored = await listMessagesByNotebook(db, notebookId);
    expect(stored.filter((m) => m.role === "user")).toHaveLength(1);
    const assistant = stored.find((m) => m.role === "assistant");
    expect(assistant?.citations).toEqual(reply.citations);
    expect(assistant?.content).toBe("Gammastrahlen sind elektromagnetische Strahlung [1].");
  });

  it("falls back to textual retrieval without an embedder — no silent hybrid claim", async () => {
    await seedProfileWithVector("alpha particles are heavy");

    const reply = await sendChatMessage(db, {
      notebookId,
      ownerId: "local",
      message: "alpha particles",
      chat: async () => "Alpha-Teilchen [E1].",
      embedQuery: null,
    });

    expect(reply.mode).toBe("fts");
    expect(reply.vectorStatus).toBe("unavailable");
    expect(reply.citations).toHaveLength(1);
  });
});
