export type MdBlock = { type: string; content: string; items: string[] };

export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    if (!trimmed.trim()) { blocks.push({ type: "blank", content: "", items: [] }); i++; continue; }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", content: codeLines.join("\n"), items: [] });
      i++;
      continue;
    }

    if (trimmed.startsWith("#### ")) { blocks.push({ type: "h4", content: trimmed.slice(5), items: [] }); i++; continue; }
    if (trimmed.startsWith("### ")) { blocks.push({ type: "h3", content: trimmed.slice(4), items: [] }); i++; continue; }
    if (trimmed.startsWith("## ")) { blocks.push({ type: "h2", content: trimmed.slice(3), items: [] }); i++; continue; }
    if (trimmed.startsWith("# ")) { blocks.push({ type: "h1", content: trimmed.slice(2), items: [] }); i++; continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { blocks.push({ type: "hr", content: "", items: [] }); i++; continue; }

    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith("> ")) {
        quoteLines.push(lines[i].trimStart().slice(2));
        i++;
      }
      blocks.push({ type: "quote", content: quoteLines.join(" "), items: [] });
      continue;
    }

    if (/^[-*+]\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        items.push(lines[i].trimStart().replace(/^[-*+]\s/, ""));
        i++;
      }
      blocks.push({ type: "ul", content: "", items });
      continue;
    }

    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        items.push(lines[i].trimStart().replace(/^\d+\.\s/, ""));
        i++;
      }
      blocks.push({ type: "ol", content: "", items });
      continue;
    }

    blocks.push({ type: "p", content: trimmed, items: [] });
    i++;
  }

  return blocks;
}

export function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const arrStart = text.indexOf("[");
  const arrEnd = text.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) return text.slice(arrStart, arrEnd + 1);
  return text;
}
