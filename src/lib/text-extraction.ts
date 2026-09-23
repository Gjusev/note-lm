import { DocumentAnalysisClient, AzureKeyCredential } from "@azure/ai-form-recognizer";

const azureEndpoint = process.env.AZURE_OCR_ENDPOINT!;
const azureKey = process.env.AZURE_OCR_KEY!;

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const client = new DocumentAnalysisClient(
    azureEndpoint,
    new AzureKeyCredential(azureKey)
  );

  const poller = await client.beginAnalyzeDocument("prebuilt-read", buffer);
  const result = await poller.pollUntilDone();

  const pages: string[] = [];
  for (const page of result.pages ?? []) {
    const pageText = (page.lines ?? []).map((line) => line.content).join("\n");
    pages.push(pageText);
  }
  return pages.join("\n\n");
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
