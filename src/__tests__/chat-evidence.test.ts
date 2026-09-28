// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
vi.mock("@/lib/server/local-user", () => ({
  getSessionUser: vi.fn(async () => ({ id: "local" })), assertSameOrigin: vi.fn(async () => true),
}));
vi.mock("@/lib/openai", () => ({ chatCompletion: vi.fn() }));
let dir: string;
let previousDataDir: string | undefined;
beforeEach(() => {
  previousDataDir = process.env.NOTELM_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-evidence-"));
  process.env.NOTELM_DATA_DIR = dir;
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db);
  fs.rmSync(dir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.NOTELM_DATA_DIR;
  else process.env.NOTELM_DATA_DIR = previousDataDir;
});
describe("chat evidence roundtrip", () => {
  it("returns and persists only cited context, excluding unfinished sources and other notebooks", async () => {
    const { getLocalContext } = await import("@/lib/storage/local");
    const { createNotebook } = await import("@/lib/services/notebooks");
    const { createSource, replaceChunks, updateSourceStatus } = await import("@/lib/services/sources");
    const { listMessagesByNotebook } = await import("@/lib/services/messages");
    const { chatCompletion } = await import("@/lib/openai");
    const { db } = getLocalContext();
    const notebookId = await createNotebook(db, { ownerId: "local", title: "Research" });
    const otherId = await createNotebook(db, { ownerId: "local", title: "Other" });
    const created: string[] = [];
    for (const [index, text] of ["Quantum result in the published paper.", "Quantum unrelated material.", "Quantum unfinished source.", "Quantum private other notebook."].entries()) {
      const nb = index === 3 ? otherId : notebookId;
      const id = await createSource(db, { ownerId: "local", notebookId: nb, fileName: `${index}.pdf`, fileType: "application/pdf", fileSize: text.length });
      replaceChunks(db, { ownerId: "local", notebookId: nb, sourceId: id }, [text]);
      if (index !== 2) await updateSourceStatus(db, id, { status: "completed" });
      created.push(id);
    }
    vi.mocked(chatCompletion).mockImplementation(async (messages) => {
      const prompt = messages.map((m) => m.content).join("\n");
      expect(prompt).not.toContain("unfinished source");
      expect(prompt).not.toContain("private other notebook");
      const data = messages[1].content.split("\n\n")[1].split("\n").map((line) => JSON.parse(line));
      const excerpt = data.find((item) => item.fileName === "0.pdf");
      return `Result [${excerpt.reference}]. Repeated [${excerpt.reference}]. Unknown [E99].`;
    });
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(new NextRequest("http://localhost/api/chat", {
      method: "POST", body: JSON.stringify({ notebookId, message: "Quantum" }),
    }));
    expect(res.status).toBe(200);
    const result = await res.json();
    expect(result.response).toBe("Result [1]. Repeated [1]. Unknown [Quelle nicht verfügbar].");
    expect(result.citations).toEqual([{
      sourceId: created[0], chunkIndex: 0, text: "Quantum result in the published paper.", fileName: "0.pdf",
    }]);
    const stored = await listMessagesByNotebook(db, notebookId);
    expect(stored.find((message) => message.role === "assistant")?.citations).toEqual(result.citations);
  });
});
