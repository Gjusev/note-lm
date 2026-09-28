import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Route tests against the real local SQLite stack: fresh temp data dir per
 * test, session mocked to the local profile (no HTTP cookies in vitest).
 */

vi.mock("@/lib/server/local-user", () => ({
  getSessionUser: vi.fn(async () => ({ id: "local", name: "Lokal", email: "local@note-lm.local" })),
  requireSessionUser: vi.fn(async () => ({ id: "local", name: "Lokal", email: "local@note-lm.local" })),
  assertSameOrigin: vi.fn(async () => true),
  SESSION_COOKIE: "notelm_session",
}));

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "notelm-api-"));
  process.env.NOTELM_DATA_DIR = dir;
  vi.resetModules();
});

afterEach(async () => {
  const { getLocalContext } = await import("@/lib/storage/local");
  const { closeLocalDb } = await import("@/db/local");
  closeLocalDb(getLocalContext().db);
  fs.rmSync(dir, { recursive: true, force: true });
});

async function makeNotebook(): Promise<string> {
  const { POST } = await import("@/app/api/notebooks/route");
  const res = await POST(new Request("http://localhost/api/notebooks", {
    method: "POST",
    body: JSON.stringify({ title: "Testbuch" }),
  }) as any);
  const data = await res.json();
  return data.id;
}

// ── Notebooks ──

describe("/api/notebooks", () => {
  it("rejects a missing title", async () => {
    const { POST } = await import("@/app/api/notebooks/route");
    const res = await POST(new Request("http://localhost/api/notebooks", {
      method: "POST",
      body: JSON.stringify({}),
    }) as any);
    expect(res.status).toBe(400);
  });

  it("creates and lists notebooks", async () => {
    const id = await makeNotebook();
    expect(id).toBeTruthy();
    const { GET } = await import("@/app/api/notebooks/route");
    const res = await GET();
    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0]._id).toBe(id);
    expect(list[0].title).toBe("Testbuch");
  });

  it("deletes a notebook with 404 on unknown id", async () => {
    const id = await makeNotebook();
    const { DELETE } = await import("@/app/api/notebooks/[id]/route");
    const ok = await DELETE(null as any, { params: Promise.resolve({ id }) });
    expect(ok.status).toBe(200);
    const missing = await DELETE(null as any, { params: Promise.resolve({ id: "gibtsnich" }) });
    expect(missing.status).toBe(404);
  });
});

// ── URL Fetch Route ──

describe("/api/fetch-url", () => {
  it("rejects missing notebookId", async () => {
    const { POST } = await import("@/app/api/fetch-url/route");
    const res = await POST(new Request("http://localhost/api/fetch-url", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
    }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("notebookId");
  });

  it("rejects invalid URLs", async () => {
    const notebookId = await makeNotebook();
    const { POST } = await import("@/app/api/fetch-url/route");
    const res = await POST(new Request("http://localhost/api/fetch-url", {
      method: "POST",
      body: JSON.stringify({ url: "not-a-url", notebookId }),
    }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("URL");
  });

  it("rejects non-HTTP protocols", async () => {
    const notebookId = await makeNotebook();
    const { POST } = await import("@/app/api/fetch-url/route");
    const res = await POST(new Request("http://localhost/api/fetch-url", {
      method: "POST",
      body: JSON.stringify({ url: "ftp://example.com", notebookId }),
    }) as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("HTTP");
  });

  it("accepts forceText to create source with chunks", async () => {
    const notebookId = await makeNotebook();
    const { POST } = await import("@/app/api/fetch-url/route");
    const res = await POST(new Request("http://localhost/api/fetch-url", {
      method: "POST",
      body: JSON.stringify({
        forceText: "Some text content here that is long enough to be valid for a source",
        title: "Manual Source",
        notebookId,
      }),
    }) as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sourceId).toBeTruthy();
    expect(data.chunksCreated).toBeGreaterThanOrEqual(1);
  });
});

// ── Search Route ──

describe("/api/search", () => {
  function nextRequest(url: string) {
    const req = new Request(url);
    return Object.assign(req, {
      nextUrl: { searchParams: new URL(url).searchParams, pathname: new URL(url).pathname },
    }) as any;
  }

  it("rejects missing query", async () => {
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(nextRequest("http://localhost/api/search"));
    expect(res.status).toBe(400);
  });

  it("501s for web search without SEAR_ENDPOINT", async () => {
    delete process.env.SEAR_ENDPOINT;
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(nextRequest("http://localhost/api/search?q=test"));
    expect(res.status).toBe(501);
  });

  it("searches notebook chunks locally via FTS", async () => {
    const notebookId = await makeNotebook();
    const { POST } = await import("@/app/api/fetch-url/route");
    await POST(new Request("http://localhost/api/fetch-url", {
      method: "POST",
      body: JSON.stringify({
        forceText: "Quantenphysik beschreibt das Verhalten von Teilchen und Wellen in Experimenten.",
        title: "Physik",
        notebookId,
      }),
    }) as any);

    const { GET } = await import("@/app/api/search/route");
    const res = await GET(nextRequest(`http://localhost/api/search?q=quantenphysik&notebookId=${notebookId}`));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scope).toBe("notebook");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].content).toContain("Quantenphysik");
  });
});

// ── Generate / Chat validation ──

describe("/api/generate + /api/chat", () => {
  it("generate rejects missing parameters", async () => {
    const { POST } = await import("@/app/api/generate/route");
    const res = await POST(new Request("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({}),
    }) as any);
    expect(res.status).toBe(400);
  });

  it("chat rejects missing parameters", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({}),
    }) as any);
    expect(res.status).toBe(400);
  });
});

// ── Local session route ──

describe("/api/auth/local", () => {
  it("returns the local profile", async () => {
    const { GET } = await import("@/app/api/auth/local/route");
    const req = Object.assign(new Request("http://localhost/api/auth/local"), {
      nextUrl: { searchParams: new URL("http://localhost/api/auth/local").searchParams },
    }) as any;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user.id).toBe("local");
  });
});
