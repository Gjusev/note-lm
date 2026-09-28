// Probe: sqlite-vec vec0 extension vs this repo's better-sqlite3 (issue #9/#3/#4).
// Run: node scripts/probes/sqlite-vec/probe.mjs
// Mirrors src/db/local/index.ts pragmas: WAL, synchronous=NORMAL, foreign_keys=ON, busy_timeout=5000.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { getLoadablePath } from "sqlite-vec";

const out = [];
const log = (...a) => { const s = a.join(" "); out.push(s); console.log(s); };
const section = (t) => log(`\n=== ${t} ===`);
const attempt = (label, fn) => {
  try { const r = fn(); log(`[OK] ${label}${r === undefined ? "" : ": " + String(r)}`); return { ok: true, r }; }
  catch (e) { log(`[FAIL] ${label}: ${String(e.message).split("\n")[0]}`); return { ok: false, e }; }
};

const extPath = getLoadablePath();
log(`node ${process.version} ${process.platform}-${process.arch}`);
log(`sqlite-vec getLoadablePath() -> ${extPath}`);
log(`vec0.dll size: ${fs.statSync(extPath).size} bytes`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-vec-probe-"));
const dbPath = path.join(dir, "probe.sqlite");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.loadExtension(extPath);
section("load");
log(`vec_version(): ${db.prepare("SELECT vec_version() AS v").get().v}`);
log(`sqlite_version(): ${db.prepare("SELECT sqlite_version() AS v").get().v}`);

// Vectors, dim 8. Query q = e1. Expected L2 order (squared):
//   a=[1,0,..] 0 | b=[.9,.1,0..] .02 | c=[0,1,0..] 2 | d=[-1,0,..] 4
const q = [1, 0, 0, 0, 0, 0, 0, 0];
const rows = [
  ["a", [1, 0, 0, 0, 0, 0, 0, 0], "nb1"],
  ["b", [0.9, 0.1, 0, 0, 0, 0, 0, 0], "nb1"],
  ["c", [0, 1, 0, 0, 0, 0, 0, 0], "nb2"],
  ["d", [-1, 0, 0, 0, 0, 0, 0, 0], "nb2"],
];

section("A) plain vec0, text primary key, KNN MATCH + LIMIT");
attempt("CREATE vec0 chunks_vec(chunk_id text primary key, embedding float[8])", () =>
  db.exec("CREATE VIRTUAL TABLE chunks_vec USING vec0(chunk_id text primary key, embedding float[8])"));
const ins = db.prepare("INSERT INTO chunks_vec(chunk_id, embedding) VALUES (?, vec_f32(?))");
for (const [id, v] of rows) ins.run(id, JSON.stringify(v));
const knn = db.prepare("SELECT chunk_id, distance FROM chunks_vec WHERE embedding MATCH vec_f32(?) AND k = 3");
log("KNN k=3 for q=[1,0,...]:");
for (const r of knn.all(JSON.stringify(q))) log(`  chunk_id=${r.chunk_id} distance=${r.distance}`);
// LIMIT-form KNN (k=? vs LIMIT): vec0 needs "k ="; plain LIMIT is not a KNN constraint in 0.1.x
attempt("KNN with LIMIT instead of k= (WHERE embedding MATCH ? LIMIT 3)", () =>
  db.prepare("SELECT chunk_id, distance FROM chunks_vec WHERE embedding MATCH vec_f32(?) LIMIT 3").all(JSON.stringify(q)).length + " rows");
// Buffer-bind form (how the engine would bind float32 blobs)
const f32 = (arr) => { const b = Buffer.alloc(4 * arr.length); arr.forEach((x, i) => b.writeFloatLE(x, 4 * i)); return b; };
attempt("KNN with Buffer(float32le) bind", () => {
  const r = db.prepare("SELECT chunk_id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = 1").get(f32(q));
  return JSON.stringify(r);
});

section("B) metadata column (filter inside KNN)");
attempt("CREATE vec0 meta(notebook_id text metadata, +note text, embedding float[8])", () =>
  db.exec("CREATE VIRTUAL TABLE chunks_meta USING vec0(chunk_id text primary key, notebook_id text metadata, +note text, embedding float[8])"));
const insM = db.prepare("INSERT INTO chunks_meta(chunk_id, notebook_id, note, embedding) VALUES (?, ?, ?, vec_f32(?))");
for (const [id, v, nb] of rows) insM.run(id, nb, `note-${id}`, JSON.stringify(v));
attempt("KNN + metadata filter (notebook_id = 'nb1', k=2)", () => {
  const r = db.prepare("SELECT chunk_id, distance FROM chunks_meta WHERE embedding MATCH ? AND notebook_id = ? AND k = 2").all(f32(q), "nb1");
  return JSON.stringify(r);
});
attempt("KNN + metadata filter with IN (...)", () => {
  const r = db.prepare("SELECT chunk_id FROM chunks_meta WHERE embedding MATCH ? AND notebook_id IN (?, ?) AND k = 4").all(f32(q), "nb1", "nb2");
  return JSON.stringify(r);
});
attempt("KNN + filter on auxiliary +note (expected unsupported)", () =>
  db.prepare("SELECT chunk_id FROM chunks_meta WHERE embedding MATCH ? AND note = 'note-a' AND k = 2").all(f32(q)));

section("C) partition key");
const partCreate = attempt("CREATE vec0(notebook_id text partition key, embedding float[8])", () =>
  db.exec("CREATE VIRTUAL TABLE chunks_part USING vec0(chunk_id text primary key, notebook_id text partition key, embedding float[8])"));
if (partCreate.ok) {
  const insP = db.prepare("INSERT INTO chunks_part(chunk_id, notebook_id, embedding) VALUES (?, ?, vec_f32(?))");
  for (const [id, v, nb] of rows) insP.run(id, nb, JSON.stringify(v));
  attempt("KNN restricted to partition (partition key = ? in WHERE)", () => {
    const r = db.prepare("SELECT chunk_id, distance FROM chunks_part WHERE embedding MATCH ? AND notebook_id = ? AND k = 2").all(f32(q), "nb1");
    return JSON.stringify(r);
  });
  attempt("KNN via vec0 partition syntax (SET probs?) — plain WHERE without partition filter", () => {
    const r = db.prepare("SELECT chunk_id, distance FROM chunks_part WHERE embedding MATCH ? AND k = 2").all(f32(q));
    return JSON.stringify(r);
  });
}

section("D) DELETE + point query");
attempt("DELETE one row then KNN", () => {
  db.prepare("DELETE FROM chunks_vec WHERE chunk_id = ?").run("d");
  const r = db.prepare("SELECT chunk_id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = 10").all(f32(q));
  return JSON.stringify(r);
});
attempt("KNN with k > row count", () =>
  db.prepare("SELECT chunk_id FROM chunks_vec WHERE embedding MATCH ? AND k = 100").all(f32(q)).length + " rows");

section("E) preloading across open handles (bundling caveat)");
attempt("reopen same db file, fresh handle, load ext, query persisted vec0 table", () => {
  const db2 = new Database(dbPath);
  db2.loadExtension(getLoadablePath());
  const r = db2.prepare("SELECT chunk_id, distance FROM chunks_vec WHERE embedding MATCH ? AND k = 2").all(f32(q));
  db2.close();
  return JSON.stringify(r);
});

db.close();
fs.rmSync(dir, { recursive: true, force: true });
log("\nprobe dir cleaned:", dir);
