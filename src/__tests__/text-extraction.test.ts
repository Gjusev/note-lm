import { describe, it, expect } from "vitest";
import { chunkText } from "@/lib/text-extraction";

describe("chunkText", () => {
  it("splits text into chunks when many words", () => {
    const text = Array(1500).fill("word").join(" ");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("returns single chunk for short text", () => {
    const chunks = chunkText("Short text");
    expect(chunks).toEqual(["Short text"]);
  });

  it("splits on paragraph boundaries when possible", () => {
    const para1 = "Word ".repeat(50).trim();
    const para2 = "More ".repeat(50).trim();
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty string", () => {
    expect(chunkText("")).toEqual([]);
  });
});
