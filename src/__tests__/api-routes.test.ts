import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock environment
beforeEach(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "http://convex.test";
  process.env.INTERNAL_API_KEY = "test-key";
  process.env.OPENAI_API_KEY = "test-openai-key";
});

// Mock OpenAI before any imports that use it
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: vi.fn() } };
    audio = { speech: { create: vi.fn() }, transcriptions: { create: vi.fn() } };
    embeddings = { create: vi.fn() };
  },
}));

function mockFetch(responses: Record<string, unknown>) {
  global.fetch = vi.fn().mockImplementation(async (url: string | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    for (const [pattern, response] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) {
        return {
          ok: true,
          status: 200,
          json: async () => response,
          text: async () => JSON.stringify(response),
        };
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    };
  }) as any;
}

function mockNextRequest(url: string, init?: RequestInit) {
  const req = new Request(url, init);
  const parsedUrl = new URL(url);
  return Object.assign(req, {
    nextUrl: {
      searchParams: parsedUrl.searchParams,
      pathname: parsedUrl.pathname,
      href: parsedUrl.href,
    },
  }) as any;
}

// ── URL Fetch Route ──

describe("/api/fetch-url", () => {
  it("rejects missing notebookId or ownerId", async () => {
    const { POST } = await import("@/app/api/fetch-url/route");
    const req = new Request("http://localhost/api/fetch-url", {
      method: "POST",
      body: JSON.stringify({ url: "https://example.com" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("notebookId");
  });

  it("rejects invalid URLs", async () => {
    mockFetch({});
    const { POST } = await import("@/app/api/fetch-url/route");
    const req = new Request("http://localhost/api/fetch-url", {
      method: "POST",
      body: JSON.stringify({ url: "not-a-url", notebookId: "nb1", ownerId: "u1" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("URL");
  });

  it("rejects non-HTTP protocols", async () => {
    mockFetch({});
    const { POST } = await import("@/app/api/fetch-url/route");
    const req = new Request("http://localhost/api/fetch-url", {
      method: "POST",
      body: JSON.stringify({ url: "ftp://example.com", notebookId: "nb1", ownerId: "u1" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("HTTP");
  });

  it("accepts forceText to create source directly", async () => {
    mockFetch({
      "/api/mutation": { value: "src1" },
    });
    const { POST } = await import("@/app/api/fetch-url/route");
    const req = new Request("http://localhost/api/fetch-url", {
      method: "POST",
      body: JSON.stringify({
        forceText: "Some text content here that is long enough to be valid for a source",
        title: "Manual Source",
        notebookId: "nb1",
        ownerId: "u1",
      }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sourceId).toBe("src1");
  });
});

// ── Search Route ──

describe("/api/search", () => {
  it("rejects missing query", async () => {
    const { GET } = await import("@/app/api/search/route");
    const req = mockNextRequest("http://localhost/api/search");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns search results", async () => {
    mockFetch({
      "/search": {
        results: [
          { title: "Result 1", url: "https://example.com/1", content: "Snippet 1" },
        ],
      },
    });
    const { GET } = await import("@/app/api/search/route");
    const req = mockNextRequest("http://localhost/api/search?q=test");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThan(0);
  });
});

// ── Generate Route ──

describe("/api/generate", () => {
  it("rejects missing parameters", async () => {
    const { POST } = await import("@/app/api/generate/route");
    const req = new Request("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it("handles missing source content", async () => {
    mockFetch({
      "/api/mutation": { value: null },
      "/api/query": { value: [] },
    });
    const { POST } = await import("@/app/api/generate/route");
    const req = new Request("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({ materialId: "m1", notebookId: "nb1", type: "summary" }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});

// ── Chat Route ──

describe("/api/chat", () => {
  it("rejects missing parameters", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });
});
