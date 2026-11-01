import { auditEventRepository, getSelectedChannelId, setSelectedChannelId } from "@/lib/db";
import { createWriteContextYoutubeApiAdapter } from "@/lib/write-context/adapters/youtube-api";
import { createWriteContextService } from "@/lib/write-context/service";
import { createMetadataGenerator } from "./adapters/metadata-generator";
import { createDefaultLogger } from "./adapters/logger";
import { createTranscriptProvider } from "./adapters/transcript-provider";
import { createYoutubeApiAdapter } from "./adapters/youtube-api";
import { resolveGoogleCredentials } from "./adapters/google-auth";
import { createVideoMetadataServices } from "./services";

function defaultAuthResolver() {
  return {
    resolve: resolveGoogleCredentials,
  };
}

export function createVideoMetadataCore() {
  const writeContext = createWriteContextService({
    youtubeApi: createWriteContextYoutubeApiAdapter(),
    channelSelectionStore: {
      getSelectedChannelId,
      setSelectedChannelId,
    },
  });

  const services = createVideoMetadataServices({
    authResolver: defaultAuthResolver(),
    youtubeApi: createYoutubeApiAdapter(),
    transcriptProvider: createTranscriptProvider(),
    metadataGenerator: createMetadataGenerator(),
    logger: createDefaultLogger({ sink: auditEventRepository }),
    writeContext,
    channelSelectionStore: {
      setSelectedChannelId,
    },
  });

  return services;
}

export type VideoMetadataCore = ReturnType<typeof createVideoMetadataCore>;
