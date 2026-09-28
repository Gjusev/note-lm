import { extractTextFromHtml, extractTitleFromHtml } from "./html-extract";
import { IdentifiedResource, ImportError, InspectResult, DownloadPlan, ProviderAdapter } from "./types";

/**
 * Generic web adapter: HTML pages and anything that turns out to be a direct
 * file after the response arrives. inspect() stays cheap (no full download);
 * the worker decides page-vs-file from the verified content type.
 */
export const webAdapter: ProviderAdapter = {
  id: "web",
  async inspect(_resource: IdentifiedResource): Promise<InspectResult> {
    // Title is only known after fetching; nothing to inspect without a download.
    return {};
  },
  async resolve(resource: IdentifiedResource): Promise<DownloadPlan> {
    return {
      url: resource.originalUrl,
      expect: "html",
      fileNameHint: resource.canonicalUrl.split("/").pop() || "page.html",
    };
  },
};

/** Page processing used by the worker once the download is verified as HTML. */
export function processHtmlPage(html: string, fallbackTitle: string) {
  const title = extractTitleFromHtml(html, fallbackTitle);
  const text = extractTextFromHtml(html);
  if (text.trim().length < 50) {
    throw new ImportError("bad_content", "Seite enthält zu wenig Textinhalt");
  }
  return { title, text };
}
