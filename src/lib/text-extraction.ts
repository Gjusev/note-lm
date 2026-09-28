import { PDFParse } from "pdf-parse";
import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

/**
 * Text extraction. Local-first: pdf-parse (PDF.js) for PDFs, no network.
 * Azure OCR stays available as an OPTIONAL provider for scanned/mixed PDFs
 * that carry no text layer; without it, such files fail with a clear message
 * instead of silently calling a cloud service.
 *
 * ponytail: local OCR (PDF.js render + Tesseract.js, plan §4) is the known
 * upgrade path when scanned-PDF support must work offline.
 */

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = result.pages.map((p) => p.text).join("\n\n").trim();
    if (text.length > 0) return text;
  } finally {
    await parser.destroy?.();
  }

  // No text layer (scanned PDF) → optional Azure provider
  const endpoint = process.env.AZURE_OCR_ENDPOINT;
  const key = process.env.AZURE_OCR_KEY;
  if (endpoint && key) {
    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
    const poller = await client.beginAnalyzeDocument("prebuilt-read", buffer);
    const result = await poller.pollUntilDone();
    const pages: string[] = [];
    for (const page of result.pages ?? []) {
      pages.push((page.lines ?? []).map((line) => line.content).join("\n"));
    }
    return pages.join("\n\n");
  }

  throw new Error(
    "PDF enthält keinen Text (Scan). Lokale Texterkennung ist noch nicht konfiguriert; optional AZURE_OCR_ENDPOINT/AZURE_OCR_KEY setzen."
  );
}

export async function extractTextFromFile(
  buffer: Buffer,
  fileType: string
): Promise<string> {
  if (fileType === "application/pdf") {
    return extractTextFromPDF(buffer);
  }

  if (
    fileType === "text/plain" ||
    fileType === "text/markdown" ||
    fileType === "application/markdown"
  ) {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}

export function chunkText(text: string, maxChunkSize = 1000, overlap = 200): string[] {
  const chunks: string[] = [];
  const words = text.split(/\s+/);
  let i = 0;

  while (i < words.length) {
    const chunkWords = words.slice(i, i + maxChunkSize);
    chunks.push(chunkWords.join(" "));
    i += maxChunkSize - overlap;
    if (i < 0) i = 0;
  }

  return chunks.filter((c) => c.trim().length > 0);
}
