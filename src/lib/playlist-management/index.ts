import { auditEventRepository, getSelectedChannelId, setSelectedChannelId } from "@/lib/db";
import { createWriteContextYoutubeApiAdapter } from "@/lib/write-context/adapters/youtube-api";
import { createWriteContextService } from "@/lib/write-context/service";
import { resolveGoogleCredentials } from "@/lib/video-metadata/adapters/google-auth";
import { createPlaylistYoutubeApiAdapter } from "./adapters/youtube-api";
import { createDefaultLogger } from "../video-metadata/adapters/logger";
import { createPlaylistManagementServices } from "./services";

function defaultAuthResolver() {
  return {
    resolve: resolveGoogleCredentials,
  };
}

export function createPlaylistManagementCore() {
  const writeContext = createWriteContextService({
    youtubeApi: createWriteContextYoutubeApiAdapter(),
    channelSelectionStore: {
      getSelectedChannelId,
      setSelectedChannelId,
    },
  });

  return createPlaylistManagementServices({
    authResolver: defaultAuthResolver(),
    youtubeApi: createPlaylistYoutubeApiAdapter(),
    writeContext,
    channelSelectionStore: {
      setSelectedChannelId,
    },
    logger: createDefaultLogger({ sink: auditEventRepository }),
  });
}

export type PlaylistManagementCore = ReturnType<typeof createPlaylistManagementCore>;
