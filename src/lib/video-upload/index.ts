import { getSelectedChannelId, setSelectedChannelId, quotaClient } from "../db";
import { createDurableQuotaAccountant } from "../quota/accountant";
import type { ResolvedCredentials } from "../video-metadata/contracts";
import { resolveGoogleCredentials } from "../video-metadata/adapters/google-auth";
import { createWriteContextYoutubeApiAdapter } from "../write-context/adapters/youtube-api";
import { createWriteContextService } from "../write-context/service";
import { localUploadFiles, youtubeUploadProvider } from "./adapters/youtube-api";
import { createVideoUploadService, type VideoUploadDependencies } from "./services";
import { createMultiVideoUploadService } from "./multi-video";

export { createVideoUploadService } from "./services";
export { createMultiVideoUploadService } from "./multi-video";
export type { MultiVideoUploadDependencies, MultiVideoUploadItemResult, MultiVideoUploadPreviewItem, MultiVideoUploadResult } from "./multi-video";
export type { UploadRequest, UploadResult, UploadFileSource, UploadProvider } from "./contracts";

export function createUserUploadQuotaAccountant(credentials: ResolvedCredentials) {
  if (!("userId" in credentials.credentialRef) || !credentials.credentialRef.userId.trim()) {
    throw new Error("User-scoped upload credentials are required");
  }
  return createDurableQuotaAccountant({
    client: quotaClient,
    scope: { kind: "user", userId: credentials.credentialRef.userId },
  });
}

export function createVideoUploadCore(deps?: Partial<VideoUploadDependencies>) {
  return createVideoUploadService({
    ...deps,
    authResolver: deps?.authResolver ?? { resolve: resolveGoogleCredentials },
    writeContext: deps?.writeContext ?? createWriteContextService({
      youtubeApi: createWriteContextYoutubeApiAdapter(),
      channelSelectionStore: { getSelectedChannelId, setSelectedChannelId },
    }),
    files: deps?.files ?? localUploadFiles,
    provider: deps?.provider ?? youtubeUploadProvider,
    quotaAccountantFactory: deps?.quotaAccountantFactory ?? createUserUploadQuotaAccountant,
  });
}

export function createMultiVideoUploadCore(deps?: Partial<VideoUploadDependencies>) {
  const files = deps?.files ?? localUploadFiles;
  return createMultiVideoUploadService({
    upload: createVideoUploadCore(deps),
    files,
    confirmationSecret: process.env.NEXTAUTH_SECRET ?? "",
  });
}
