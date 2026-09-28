// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { AddressInfo } from "node:net";
import { openLocalDb, closeLocalDb, type LocalDb } from "@/db/local";
import { importModelFromFile, listModels, downloadModel, hashFile } from "@/lib/services/models";

let dir: string;
let db: LocalDb;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-models-"));
  db = openLocalDb(dir);
});

afterEach(() => {
  closeLocalDb(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

const gguf = (bytes: number): Buffer => {
  const b = Buffer.alloc(bytes);
  b.write("GGUF", 0, "ascii");
  return b;
};

describe("model library (phase 5)", () => {
  it("imports a file, verifies by hash and is idempotent on re-import", async () => {
    const src = path.join(dir, "chat.gguf");
    fs.writeFileSync(src, gguf(1024));

    const first = await importModelFromFile(db, dir, src, "chat");
    expect(first.deduped).toBe(false);
    expect(first.model.capability).toBe("chat");
    expect(first.model.sizeBytes).toBe(1024);
    expect(first.model.status).toBe("available");
    // the managed copy lives in <dataDir>/models/<sha256>.gguf
    expect(fs.existsSync(path.join(dir, first.model.path))).toBe(true);

    // same content elsewhere → deduped, single row
    const src2 = path.join(dir, "copy.gguf");
    fs.writeFileSync(src2, gguf(1024));
    const again = await importModelFromFile(db, dir, src2, "chat");
    expect(again.deduped).toBe(true);
    expect(again.model._id).toBe(first.model._id);
    expect(listModels(db)).toHaveLength(1);
  });

  it("downloads with verification and rejects a bad hash", async () => {
    const payload = gguf(2048);
    const sha = createHash("sha256").update(payload).digest("hex");
    let servedOnce = false;
    const server = http.createServer((req, res) => {
      if (req.headers.range) {
        const start = parseInt(req.headers.range.replace("bytes=", "").split("-")[0], 10);
        servedOnce = true;
        res.writeHead(206, { "content-length": String(payload.length - start) });
        res.end(payload.subarray(start));
      } else {
        res.writeHead(200, { "content-length": String(payload.length), "accept-ranges": "bytes" });
        res.end(payload);
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/m.gguf`;

    const model = await downloadModel(db, dir, {
      url, capability: "embeddings", fileName: "m.gguf", sha256: sha,
    });
    expect(model.sha256).toBe(sha);
    expect(await hashFile(path.join(dir, model.path))).toBe(sha);

    // resume path: pre-seed a partial file, download again — server sees Range
    const p2 = path.join(dir, "models", `${sha}.gguf.part`);
    fs.writeFileSync(p2, payload.subarray(0, 512));
    const m2 = await downloadModel(db, dir, {
      url, capability: "embeddings", fileName: "m2.gguf", sha256: sha,
    });
    expect(servedOnce).toBe(true);
    expect(m2.sha256).toBe(sha);

    // wrong expected hash → rejected, temp cleaned, no row
    const bad = await downloadModel(db, dir, {
      url, capability: "embeddings", fileName: "bad.gguf", sha256: "0".repeat(64),
    }).catch((e) => e as Error);
    expect(bad).toBeInstanceOf(Error);
    expect(listModels(db).filter((m) => m.fileName === "bad.gguf")).toHaveLength(0);

    // undici keeps the pooled keep-alive connection open — close() alone
    // would hang waiting for it; drop the connections first
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
});
