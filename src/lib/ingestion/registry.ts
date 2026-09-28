import { ProviderAdapter, ProviderId } from "./types";
import { webAdapter } from "./web";
import { directFileAdapter } from "./direct-file";
import { youtubeAdapter } from "./providers/youtube";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  web: webAdapter,
  "direct-file": directFileAdapter,
  youtube: youtubeAdapter,
};

export function getAdapter(provider: ProviderId): ProviderAdapter {
  return ADAPTERS[provider];
}
