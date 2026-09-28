import { IdentifiedResource, DownloadPlan, InspectResult, ProviderAdapter } from "./types";

/** Direct file URLs (pdf/txt/md/audio/video by extension). Download does the real work. */
export const directFileAdapter: ProviderAdapter = {
  id: "direct-file",
  async inspect(resource: IdentifiedResource): Promise<InspectResult> {
    return { title: resource.canonicalUrl.split("/").pop() || resource.canonicalUrl };
  },
  async resolve(resource: IdentifiedResource): Promise<DownloadPlan> {
    const kindToExpect: Record<string, DownloadPlan["expect"]> = {
      document: "document",
      audio: "audio",
      video: "video",
      page: "html",
    };
    return {
      url: resource.originalUrl,
      expect: kindToExpect[resource.kind] ?? "html",
      fileNameHint: resource.canonicalUrl.split("/").pop() || "download",
    };
  },
};
