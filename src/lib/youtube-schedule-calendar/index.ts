import { resolveGoogleCredentials } from "../video-metadata/adapters/google-auth";
import { quotaClient } from "../db";
import { createDurableQuotaAccountant } from "../quota/accountant";
import { createYoutubeScheduleApi } from "./adapters/youtube-api";
import type { YoutubeScheduleDependencies } from "./contracts";
import { createScheduledYoutubeVideosService } from "./services";
export type {
  ScheduledYoutubeVideo,
  ScheduledYoutubeVideosError,
  ScheduledYoutubeVideosErrorCode,
  ScheduledYoutubeVideosResponse,
  ScheduledYoutubeVideosResult,
} from "./contracts";

export function createScheduledYoutubeVideos(deps?: Partial<YoutubeScheduleDependencies>) {
  const service = createScheduledYoutubeVideosService({
    ...deps,
    authResolver: deps?.authResolver ?? { resolve: resolveGoogleCredentials },
    api: deps?.api ?? createYoutubeScheduleApi(),
    quotaAccountantFactory:
      deps?.quotaAccountantFactory ??
      ((credentials) => {
        if (!("userId" in credentials.credentialRef)) {
          throw new Error("User-scoped YouTube credentials are required");
        }
        return createDurableQuotaAccountant({
          client: quotaClient,
          scope: { kind: "user", userId: credentials.credentialRef.userId },
        });
      }),
  });
  return { fetchScheduledVideos: service };
}
