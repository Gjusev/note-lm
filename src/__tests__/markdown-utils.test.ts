import { describe, it, expect } from "vitest";
import { parseMarkdown, extractJSON } from "@/lib/markdown-utils";

describe("parseMarkdown", () => {
  it("parses h1-h4 headings", () => {
    const blocks = parseMarkdown("# Title\n## Subtitle\n### Section\n#### Sub");
    expect(blocks).toEqual([
      { type: "h1", content: "Title", items: [] },
      { type: "h2", content: "Subtitle", items: [] },
      { type: "h3", content: "Section", items: [] },
      { type: "h4", content: "Sub", items: [] },
    ]);
  });

  it("parses paragraphs", () => {
    const blocks = parseMarkdown("Hello world\n\nSecond paragraph");
    expect(blocks).toEqual([
      { type: "p", content: "Hello world", items: [] },
      { type: "blank", content: "", items: [] },
      { type: "p", content: "Second paragraph", items: [] },
    ]);
  });

  it("parses unordered lists", () => {
    const blocks = parseMarkdown("- Item A\n- Item B\n- Item C");
    expect(blocks).toEqual([
      { type: "ul", content: "", items: ["Item A", "Item B", "Item C"] },
    ]);
  });

  it("parses ordered lists", () => {
    const blocks = parseMarkdown("1. First\n2. Second\n3. Third");
    expect(blocks).toEqual([
      { type: "ol", content: "", items: ["First", "Second", "Third"] },
    ]);
  });

  it("parses blockquotes", () => {
    const blocks = parseMarkdown("> This is a quote\n> Second line");
    expect(blocks).toEqual([
      { type: "quote", content: "This is a quote Second line", items: [] },
    ]);
  });

  it("parses fenced code blocks", () => {
    const blocks = parseMarkdown("```js\nconst x = 1;\nconsole.log(x);\n```");
    expect(blocks).toEqual([
      { type: "code", content: "const x = 1;\nconsole.log(x);", items: [] },
    ]);
  });

  it("parses horizontal rules", () => {
    expect(parseMarkdown("---")[0].type).toBe("hr");
    expect(parseMarkdown("***")[0].type).toBe("hr");
    expect(parseMarkdown("___")[0].type).toBe("hr");
  });

  it("parses mixed content", () => {
    const md = `# Title

Intro paragraph

- Item 1
- Item 2

> A quote

\`\`\`
code here
\`\`\`

---

Final paragraph`;

    const blocks = parseMarkdown(md);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual([
      "h1", "blank", "p", "blank", "ul", "blank", "quote", "blank",
      "code", "blank", "hr", "blank", "p",
    ]);
  });

  it("handles empty input", () => {
    expect(parseMarkdown("")).toEqual([{ type: "blank", content: "", items: [] }]);
  });

  it("handles blank lines only", () => {
    const blocks = parseMarkdown("\n\n\n");
    expect(blocks.every((b) => b.type === "blank")).toBe(true);
  });

  it("handles list variants (*, +)", () => {
    const blocks = parseMarkdown("* Star item\n+ Plus item");
    expect(blocks[0].type).toBe("ul");
    expect(blocks[0].items).toEqual(["Star item", "Plus item"]);
  });
});

describe("extractJSON", () => {
  it("extracts JSON from fenced code block", () => {
    const input = "Here is data:\n```json\n[{\"a\": 1}]\n```\nDone.";
    expect(extractJSON(input)).toBe('[{"a": 1}]');
  });

  it("extracts JSON from fenced block without language tag", () => {
    const input = "```\n[{\"x\": 2}]\n```";
    expect(extractJSON(input)).toBe('[{"x": 2}]');
  });

  it("extracts JSON array from text without fence", () => {
    const input = 'Result: [{"front": "Q", "back": "A"}] end';
    expect(extractJSON(input)).toBe('[{"front": "Q", "back": "A"}]');
  });

  it("returns raw text when no JSON found", () => {
    const input = "Just plain text";
    expect(extractJSON(input)).toBe("Just plain text");
  });

  it("handles empty string", () => {
    expect(extractJSON("")).toBe("");
  });
});
