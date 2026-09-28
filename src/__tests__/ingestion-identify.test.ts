import { describe, it, expect } from "vitest";
import { classifyUrl } from "@/lib/ingestion/identify";
import { ImportError } from "@/lib/ingestion/types";

describe("classifyUrl", () => {
  it("recognizes standard watch URLs", () => {
    const r = classifyUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r.provider).toBe("youtube");
    expect(r.externalId).toBe("dQw4w9WgXcQ");
    expect(r.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("treats equivalent short links as the same resource", () => {
    const short = classifyUrl("https://youtu.be/dQw4w9WgXcQ?si=abc");
    const shorts = classifyUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    const watch = classifyUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s");
    expect(short.resourceKey).toBe("youtube:video:dQw4w9WgXcQ");
    expect(shorts.resourceKey).toBe("youtube:video:dQw4w9WgXcQ");
    expect(watch.resourceKey).toBe("youtube:video:dQw4w9WgXcQ");
  });

  it("keeps the original URL separate from the canonical one", () => {
    const r = classifyUrl("https://youtu.be/dQw4w9WgXcQ?si=xyz");
    expect(r.originalUrl).toBe("https://youtu.be/dQw4w9WgXcQ?si=xyz");
    expect(r.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("does not accept look-alike domains as YouTube", () => {
    const r = classifyUrl("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ");
    expect(r.provider).toBe("web");
  });

  it("rejects playlists and channels explicitly", () => {
    expect(() => classifyUrl("https://www.youtube.com/playlist?list=PL123")).toThrow(ImportError);
    expect(() => classifyUrl("https://www.youtube.com/@channel")).toThrow(ImportError);
  });

  it("rejects invalid ids on official hosts", () => {
    expect(() => classifyUrl("https://youtu.be/short")).toThrow(ImportError);
  });

  it("classifies direct files by extension", () => {
    expect(classifyUrl("https://example.com/paper.pdf").provider).toBe("direct-file");
    expect(classifyUrl("https://example.com/audio.mp3?token=1").kind).toBe("audio");
    expect(classifyUrl("https://example.com/talk.mp4").kind).toBe("video");
  });

  it("falls back to web pages", () => {
    const r = classifyUrl("https://example.com/article");
    expect(r.provider).toBe("web");
    expect(r.kind).toBe("page");
  });

  it("rejects non-HTTP protocols and junk", () => {
    expect(() => classifyUrl("ftp://example.com/x.pdf")).toThrow(ImportError);
    expect(() => classifyUrl("keine url")).toThrow(ImportError);
  });
});
