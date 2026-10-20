import { resolveGoogleCredentials } from "../video-metadata/adapters/google-auth";
import { quotaClient } from "../db";
import { createDurableQuotaAccountant } from "../quota/accountant";
import { createBestPublishTimesApi } from "./adapters/youtube-api";
import type { BestPublishTimesDependencies } from "./contracts";
import { createBestPublishTimesService } from "./services";
export type {
  Weekday,
  PublishSlot,
  BestPublishTimesConfidence,
  BestPublishTimesResult,
  BestPublishTimesError,
  BestPublishTimesErrorCode,
  BestPublishTimesResponse,
} from "./contracts";

export function createBestPublishTimes(
  deps?: Partial<BestPublishTimesDependencies>,
) {
  const service = createBestPublishTimesService({
    ...deps,
    authResolver: deps?.authResolver ?? { resolve: resolveGoogleCredentials },
    api: deps?.api ?? createBestPublishTimesApi(),
    quotaAccountantFactory:
      deps?.quotaAccountantFactory ??
      ((credentials) => {
        if (!("userId" in credentials.credentialRef)) {
          throw new Error("User-scoped analytics credentials are required");
        }
        return createDurableQuotaAccountant({
          client: quotaClient,
          scope: { kind: "user", userId: credentials.credentialRef.userId },
        });
      }),
  });
  return { fetchBestPublishTimes: service };
}
