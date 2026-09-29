// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { AddressInfo } from "node:net";

// local http test server → allow the loopback fetch through the SSRF policy
process.env.INGEST_ALLOW_PRIVATE = "1";

import { openLocalDb, closeLocalDb, rawClient, type LocalDb } from "@/db/local";
import { MIGRATIONS } from "@/db/local/migrations";
import { LocalStore, type LocalContext } from "@/lib/storage/local";
import { createNotebook } from "@/lib/services/notebooks";
import { createSource, replaceChunks, updateSourceStatus, getChunksBySource } from "@/lib/services/sources";
import { enqueueProcessingJob, claimProcessingJob } from "@/lib/services/processing-jobs";
import { createImportJob, claimImportJob } from "@/lib/services/import-jobs";
import { recordVersion, listVersions } from "@/lib/services/source-versions";
import { runImportJob } from "@/engine/imports";
import { runProcessingJob } from "@/engine/processing";
import { sendChatMessage } from "@/lib/services/chat";
import { stampCitationVersion, type ChatCitation } from "@/lib/services/chat";

let dir: string;
let db: LocalDb;
let ctx: LocalContext;
let notebookId: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-chunk-provenance-"));
  db = openLocalDb(dir);
  ctx = { db, store: new LocalStore(db, dir), dataDir: dir };
  notebookId = await createNotebook(db, { ownerId: "local", title: "Chunk-Provenanz" });
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

async function makeSource(fileName: string, buffer: Buffer): Promise<string> {
  const stored = await ctx.store.save(buffer, { fileName, contentType: "text/plain" });
  return createSource(db, {
    ownerId: "local",
    notebookId,
    fileName,
    fileType: "text/plain",
    fileSize: buffer.length,
    storageId: stored.id,
  });
}

/** Raw source_version_id column of every chunk of a source (snake_case row). */
function chunkVersionIds(sourceId: string): Array<string | null> {
  return (
    rawClient(db)
      .prepare(`SELECT source_version_id AS v FROM chunks WHERE source_id = ? ORDER BY chunk_index`)
      .all(sourceId) as Array<{ v: string | null }>
  ).map((r) => r.v);
}

describe("chunk provenance (chunks carry the version that produced them)", () => {
  it("chunks published by a processing run carry the version that produced them", async () => {
    const sourceId = await makeSource("notizen.txt", Buffer.from("Hochgeladene Notizen\nzweite Zeile"));
    enqueueProcessingJob(db, { ownerId: "local", sourceId, notebookId });
    const job = claimProcessingJob(db);
    expect(job).not.toBeNull();

    const outcome = await runProcessingJob(ctx, job!.id, job!.leaseToken!, job!.sourceId);
    expect(outcome).toBe("completed");

    const versions = listVersions(db, sourceId);
    expect(versions).toHaveLength(1);
    expect(getChunksBySource(db, sourceId).length).toBeGreaterThan(0);
    // every chunk row is stamped with the version the run just recorded
    expect(chunkVersionIds(sourceId)).toEqual(
      getChunksBySource(db, sourceId).map(() => versions[0].id)
    );
  });

  it("a re-import during retrieval cannot mis-stamp citations: the chunk stamps its own version", async () => {
    const sourceId = await makeSource("vertrag.txt", Buffer.from("Originalfassung mit dem Kernsatz"));
    const v1 = await recordVersion(db, ctx.store, {
      sourceId, pageTexts: ["Originalfassung mit dem Kernsatz"],
    });
    // v1 chunks published with their producing version
    replaceChunks(db, { ownerId: "local", sourceId, notebookId }, ["Originalfassung mit dem Kernsatz"], v1.id);
    await updateSourceStatus(db, sourceId, { status: "completed" });

    // a changed re-import lands v2 (latest is now v2), but v1 chunks keep
    // carrying v1 — retrieval has not re-chunked yet
    const v2 = await recordVersion(db, ctx.store, {
      sourceId, pageTexts: ["Geaenderte Fassung ohne den Kernsatz"],
    });
    expect(v2.version).toBe(2);

    const reply = await sendChatMessage(db, {
      notebookId,
      ownerId: "local",
      message: "Wie lautet der Kernsatz?",
      chat: async () => ({ text: "Der Kernsatz steht im Vertrag [E1].", provider: "test", model: "test" }),
      embedQuery: null,
      store: ctx.store,
    });

    expect(reply.citations).toHaveLength(1);
    // the citation follows the CHUNK's version (v1), never the latest (v2)
    expect(reply.citations[0].sourceVersionId).toBe(v1.id);
  });

  it("legacy chunks (null version) still stamp via latest with no regression", async () => {
    // pure helper: chunk carries a version → that wins over latest
    const citation: ChatCitation = { sourceId: "s", chunkIndex: 0, text: "x", fileName: "f" };
    expect(stampCitationVersion(citation, "chunk-v1", "latest-v2").sourceVersionId).toBe("chunk-v1");

    // pure helper: legacy chunk (null) → falls back to the retrieval-time latest
    expect(stampCitationVersion(citation, null, "latest-v2").sourceVersionId).toBe("latest-v2");
    // neither chunk version nor resolvable latest → stays unstamped
    expect(stampCitationVersion(citation, null, null)).not.toHaveProperty("sourceVersionId");

    // end-to-end: NULL-version chunks resolve through getLatestVersion
    const sourceId = await makeSource("legacy.txt", Buffer.from("Der Altbestand erwähnt die Frist."));
    replaceChunks(db, { ownerId: "local", sourceId, notebookId }, ["Der Altbestand erwähnt die Frist."]);
    await updateSourceStatus(db, sourceId, { status: "completed" });
    const v1 = await recordVersion(db, ctx.store, {
      sourceId, pageTexts: ["Der Altbestand erwähnt die Frist."],
    });

    const reply = await sendChatMessage(db, {
      notebookId,
      ownerId: "local",
      message: "Was steht im Altbestand?",
      chat: async () => ({ text: "Der Altbestand [E1].", provider: "test", model: "test" }),
      embedQuery: null,
      store: ctx.store,
    });
    expect(reply.citations[0].sourceVersionId).toBe(v1.id);
  });

  it("migration 0013 backfills existing chunks with their source's latest version id", () => {
    // build a 0012-shaped database by hand: sources + versions + chunks,
    // chunks WITHOUT the provenance column yet
    const raw = new Database(path.join(dir, "legacy.sqlite"));
    raw.pragma("foreign_keys = ON");
    for (let i = 0; i < 12; i++) {
      raw.exec(MIGRATIONS[i]);
      raw.pragma(`user_version = ${i + 1}`);
    }
    raw.exec(
      `INSERT INTO notebooks (id, owner_id, title, created_at, updated_at)
       VALUES ('nb', 'local', 'Legacy', 1, 1);
       INSERT INTO sources (id, owner_id, notebook_id, file_name, file_type, file_size, created_at, updated_at)
       VALUES ('s1', 'local', 'nb', 'a.txt', 'text/plain', 10, 1, 1);
       INSERT INTO source_versions (id, source_id, version, storage_id, file_hash, page_count, created_at)
       VALUES ('v1', 's1', 1, NULL, NULL, NULL, 1), ('v2', 's1', 2, NULL, NULL, NULL, 2);
       INSERT INTO chunks (id, owner_id, source_id, notebook_id, content, chunk_index, embedding_id, created_at)
       VALUES ('c1', 'local', 's1', 'nb', 'alt', 0, 'emb_s1_0', 1);`
    );

    // apply 0013
    raw.exec(MIGRATIONS[12]);
    raw.pragma("user_version = 13");

    const stamped = raw.prepare(`SELECT source_version_id AS v FROM chunks WHERE id = 'c1'`).get() as { v: string | null };
    raw.close();
    // backfilled to the source's CURRENT latest version (v2, not v1)
    expect(stamped.v).toBe("v2");
  });

  it("url-import chunks are backfilled with the recorded version after completion", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<html><head><title>Importseite</title></head><body><p>${"Inhalt der Importseite. ".repeat(20)}</p></body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/artikel`;
    try {
      const jobId = createImportJob(db, {
        ownerId: "local",
        notebookId,
        url: baseUrl,
        provider: "web",
        kind: "page",
        resourceKey: `web:${baseUrl}`,
      }).jobId;
      const job = claimImportJob(db);
      expect(job?._id).toBe(jobId);

      const outcome = await runImportJob(ctx, job!);
      expect(outcome).toBe("completed");

      const sourceId = (
        rawClient(db).prepare(`SELECT source_id AS id FROM import_jobs WHERE id = ?`).get(jobId) as { id: string }
      ).id;
      const versions = listVersions(db, sourceId);
      expect(versions).toHaveLength(1);
      expect(getChunksBySource(db, sourceId).length).toBeGreaterThan(0);
      expect(chunkVersionIds(sourceId)).toEqual(
        getChunksBySource(db, sourceId).map(() => versions[0].id)
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
