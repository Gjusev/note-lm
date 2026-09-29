// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.INGEST_ALLOW_PRIVATE = "1";

import { closeLocalDb, rawClient } from "@/db/local";
import { getLocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks, updateSourceStatus } from "@/lib/services/sources";
import { enqueueProcessingJob, claimProcessingJob } from "@/lib/services/processing-jobs";
import { recordVersion, getLatestVersion, readVersionMediaSegments } from "@/lib/services/source-versions";
import { createMessage, listMessagesByNotebook } from "@/lib/services/messages";
import { sendChatMessage } from "@/lib/services/chat";
import { saveClaimFromMessage, createClaim, listClaims } from "@/lib/services/claims";
import { buildEvidenceContext, resolveEvidenceReferences, formatMmss, formatTimeRange } from "@/lib/services/evidence";
import type { TranscribeFn } from "@/lib/ai/providers";

/**
 * Fake segment muxer (same seam as engine-imports.test.ts): writes segment
 * files whose BYTE SIZE encodes their duration at the muxer's constant
 * 96 kbps (12 000 bytes per second) - the same property the real muxer's
 * output has, so the duration derivation under test stays honest.
 */
const mux = vi.hoisted(() => ({ seconds: [12, 18] as number[] }));

vi.mock("@/lib/ingestion/segments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ingestion/segments")>();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  return {
    ...actual,
    toMp3Segments: vi.fn(async (_buffer: Buffer, outDir?: string) => {
      const target = outDir ?? (await fs.promises.mkdtemp(path.join(os.tmpdir(), "nolm-media-evidence-")));
      await fs.promises.mkdir(target, { recursive: true });
      const files: string[] = [];
      for (let i = 0; i < mux.seconds.length; i++) {
        const file = path.join(target, `seg00${i}.mp3`);
        await fs.promises.writeFile(file, Buffer.alloc(mux.seconds[i] * 12000)); // 96 kbps = 12000 bytes/s
        files.push(file);
      }
      return files;
    }),
  };
});

/** Injected TranscribeFn: per-segment texts keyed by segment index. */
function segmentTexts(...texts: string[]): TranscribeFn {
  return async (_buffer: Buffer, name: string) => ({
    text: texts[Number(/seg(\d+)/.exec(name)?.[1] ?? 0)] ?? "",
  });
}

let dir: string;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-media-evidence-"));
  process.env.NOTELM_DATA_DIR = dir;
  mux.seconds = [12, 18];
  notebookId = await createNotebook(getLocalContext().db, { ownerId: "local", title: "Medien" });
});

afterEach(async () => {
  closeLocalDb(getLocalContext().db); // releases WAL locks on Windows
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.NOTELM_DATA_DIR;
});

/** One audio/mpeg source whose original bytes are on disk. */
async function makeAudioSource(fileName = "interview.mp3"): Promise<string> {
  const { db, store } = getLocalContext();
  // 1 byte over the 24 MB direct-transcribe limit -> the segmented path
  const stored = await store.save(Buffer.alloc(25 * 1024 * 1024, 1), { fileName, contentType: "audio/mpeg" });
  return createSource(db, {
    ownerId: "local",
    notebookId,
    fileName,
    fileType: "audio/mpeg",
    fileSize: stored.size,
    storageId: stored.id,
  });
}

describe("media time-range evidence (open-source-innovation-strategy 5A)", () => {
  it("the upload pipeline stores segment boundaries in the version sidecar and one chunk per segment", async () => {
    const { db, store } = getLocalContext();
    const sourceId = await makeAudioSource();
    const jobId = enqueueProcessingJob(db, { ownerId: "local", sourceId, notebookId });
    const job = claimProcessingJob(db);

    const { runProcessingJob } = await import("@/engine/processing");
    const outcome = await runProcessingJob({ db, store, dataDir: dir }, jobId, job!.leaseToken!, sourceId, {
      transcribe: segmentTexts("Erster Abschnitt ueber Fristen.", "Zweiter Abschnitt ueber Kuendigungen."),
    });

    expect(outcome).toBe("completed");
    const version = getLatestVersion(db, sourceId);
    expect(version).not.toBeNull();

    // the sidecar carries REAL per-segment seconds derived from the muxed bytes
    const segments = await readVersionMediaSegments(store, version!.id);
    expect(segments).toEqual([
      { startSec: 0, endSec: 12, text: "Erster Abschnitt ueber Fristen." },
      { startSec: 12, endSec: 30, text: "Zweiter Abschnitt ueber Kuendigungen." },
    ]);

    // chunks map 1:1 onto segments: chunkIndex IS the segment index
    const chunks = rawClient(db)
      .prepare(`SELECT chunk_index AS i, content FROM chunks WHERE source_id = ? ORDER BY chunk_index`)
      .all(sourceId) as Array<{ i: number; content: string }>;
    expect(chunks).toEqual([
      { i: 0, content: "Erster Abschnitt ueber Fristen." },
      { i: 1, content: "Zweiter Abschnitt ueber Kuendigungen." },
    ]);
  });
  it("a chat citation on a media chunk carries the mm:ss range through the evidence context", async () => {
    const { db, store } = getLocalContext();
    const sourceId = await makeAudioSource();
    await recordVersion(db, store, {
      sourceId,
      mediaSegments: [
        { startSec: 0, endSec: 12, text: "Die Frist beträgt drei Monate." },
        { startSec: 12, endSec: 30, text: "Unrelated second statement." },
      ],
    });
    replaceChunks(db, { ownerId: "local", sourceId, notebookId }, ["Die Frist beträgt drei Monate.", "Unrelated second statement."]);
    await updateSourceStatus(db, sourceId, { status: "completed" });

    let seenPrompt = "";
    const reply = await sendChatMessage(db, {
      notebookId,
      ownerId: "local",
      message: "Frist",
      chat: async (messages) => {
        seenPrompt = messages.map((m) => m.content).join("\n");
        return { text: "Die Frist beträgt drei Monate [E1].", provider: "test", model: "test" };
      },
      embedQuery: null,
      store,
    });

    // the model saw the German mm:ss label...
    expect(seenPrompt).toContain("00:00-00:12");
    // ...and the citation carries the range back as numbers
    expect(reply.citations[0]).toMatchObject({ sourceId, chunkIndex: 0, startSec: 0, endSec: 12 });
    const stored = (await listMessagesByNotebook(db, notebookId)).find((m) => m.role === "assistant");
    expect(stored?.citations?.[0]).toMatchObject({ startSec: 0, endSec: 12 });
  });

  it("saveClaimFromMessage creates a time_range anchor with locator and page null", async () => {
    const { db, store } = getLocalContext();
    const sourceId = await makeAudioSource("zeugenaussage.mp3");
    const version = await recordVersion(db, store, {
      sourceId,
      mediaSegments: [
        { startSec: 192, endSec: 225, text: "Der Zeuge beschreibt den Ablauf." },
      ],
    });
    const messageId = await createMessage(db, {
      ownerId: "local",
      notebookId,
      role: "assistant",
      content: "Der Zeuge beschreibt den Ablauf [1].",
      // the citation is stamped with the retrieval-time version (provenance fix)
      citations: [{ sourceId, chunkIndex: 0, text: "Der Zeuge beschreibt den Ablauf.", sourceVersionId: version.id, startSec: 192, endSec: 225 }],
    });

    const saved = await saveClaimFromMessage(db, { notebookId, messageId, text: "Der Zeuge beschreibt den Ablauf." });
    expect(saved.anchorCount).toBe(1);
    expect(saved.unresolved).toEqual([]);

    const [claim] = listClaims(db, notebookId);
    expect(claim.anchors[0]).toMatchObject({
      fileName: "zeugenaussage.mp3",
      version: 1,
      page: null, // never invented
      locator: { startSec: 192, endSec: 225 },
    });
    const anchor = rawClient(db)
      .prepare(`SELECT kind, locator, page FROM evidence_anchors WHERE id = ?`)
      .get(claim.anchors[0].id) as { kind: string; locator: string; page: number | null };
    expect(anchor.kind).toBe("time_range");
    expect(JSON.parse(anchor.locator)).toEqual({ startSec: 192, endSec: 225 });
    expect(anchor.page).toBeNull();
  });

  it("evidence.open returns the locator; explicit locator anchors and the pdf path stay intact", async () => {
    const { db, store } = getLocalContext();
    const audioSource = await makeAudioSource("audio-anchor.mp3");
    // the original bytes live in the store, so the anchor stays resolvable
    const storageId = (rawClient(db).prepare(`SELECT storage_id AS s FROM sources WHERE id = ?`).get(audioSource) as { s: string }).s;
    await recordVersion(db, store, {
      sourceId: audioSource,
      storageId,
      mediaSegments: [{ startSec: 192, endSec: 225, text: "Kernsatz im Ton." }],
    });
    const audioClaim = await createClaim(db, {
      notebookId,
      ownerId: "local",
      text: "Zeitverankerte Behauptung.",
      origin: "user",
      anchors: [{ sourceId: audioSource, quote: "Kernsatz im Ton.", locator: { startSec: 192, endSec: 225 } }],
    });

    const { handleEngineRequest } = await import("@/engine/dispatch");
    const audioAnchorId = listClaims(db, notebookId).find((c) => c._id === audioClaim.id)!.anchors[0].id;
    const opened = await handleEngineRequest("evidence.open", { anchorId: audioAnchorId });
    expect(opened).toEqual({
      ok: true,
      result: {
        fileName: "audio-anchor.mp3",
        page: null,
        locator: { startSec: 192, endSec: 225 },
        quote: "Kernsatz im Ton.",
        storageId,
        absolutePath: expect.any(String), // the stored file under <dataDir>/files/
      },
    });

    // regression: a pdf anchor keeps its page semantics and gets no locator
    const pdfSource = await createSource(db, {
      ownerId: "local", notebookId, fileName: "gutachten.pdf", fileType: "application/pdf", fileSize: 10,
    });
    await recordVersion(db, store, { sourceId: pdfSource, pageTexts: ["Seite eins.", "Seite zwei."] });
    const pdfClaim = await createClaim(db, {
      notebookId,
      ownerId: "local",
      text: "Pdf-Verankerte Behauptung.",
      origin: "user",
      anchors: [{ sourceId: pdfSource, page: 2, quote: "Seite zwei." }],
    });
    const pdfAnchorId = listClaims(db, notebookId).find((c) => c._id === pdfClaim.id)!.anchors[0].id;
    const pdfOpened = await handleEngineRequest("evidence.open", { anchorId: pdfAnchorId });
    expect((pdfOpened as { result: { locator: unknown; page: number | null } }).result).toMatchObject({
      page: 2,
      locator: null,
    });
  });

  it("mm:ss formatting labels are zero-padded and honest about open ends", () => {
    expect(formatMmss(0)).toBe("00:00");
    expect(formatMmss(192)).toBe("03:12");
    expect(formatMmss(225)).toBe("03:45");
    expect(formatMmss(3675)).toBe("61:15"); // minutes may exceed 59 - honest mm:ss
    expect(formatTimeRange({ startSec: 192, endSec: 225 })).toBe("03:12-03:45");
    expect(formatTimeRange({ startSec: 0, endSec: null })).toBe("00:00-?");
  });
});
