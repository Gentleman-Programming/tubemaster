import { getSelectedChannelId, quotaClient, setSelectedChannelId } from "../db";
import { createDurableQuotaAccountant } from "../quota/accountant";
import type { ResolvedCredentials } from "../video-metadata/contracts";
import { resolveGoogleCredentials } from "../video-metadata/adapters/google-auth";
import { createWriteContextYoutubeApiAdapter } from "../write-context/adapters/youtube-api";
import { createWriteContextService } from "../write-context/service";
import { youtubeRecoveryProvider } from "./adapters/youtube-api";
import { createVideoRecoveryService, type VideoRecoveryDependencies } from "./services";

export { createVideoRecoveryService } from "./services";
export { youtubeRecoveryProvider } from "./adapters/youtube-api";
export type {
  RecoveryBatchReconcileItem, RecoveryBatchReconcileRequest, RecoveryBatchReconcileResult,
  RecoveryCancelRequest, RecoveryCancelResult, RecoveryProvider, RecoveryReconcileRequest, RecoveryReconcileResult,
  RecoveryReconcileProviderResult, RecoveryReturnProviderResult, RecoveryVideo,
} from "./contracts";
export type { VideoRecoveryDependencies } from "./services";

export function createUserVideoRecoveryQuotaAccountant(credentials: ResolvedCredentials) {
  if (!("userId" in credentials.credentialRef) || !credentials.credentialRef.userId.trim()) throw new Error("User-scoped recovery credentials are required");
  return createDurableQuotaAccountant({ client: quotaClient, scope: { kind: "user", userId: credentials.credentialRef.userId } });
}

export function createVideoRecoveryCore(deps?: Partial<VideoRecoveryDependencies>) {
  return createVideoRecoveryService({
    ...deps,
    authResolver: deps?.authResolver ?? { resolve: resolveGoogleCredentials },
    writeContext: deps?.writeContext ?? createWriteContextService({
      youtubeApi: createWriteContextYoutubeApiAdapter(),
      channelSelectionStore: { getSelectedChannelId, setSelectedChannelId },
    }),
    provider: deps?.provider ?? youtubeRecoveryProvider,
    quotaAccountantFactory: deps?.quotaAccountantFactory ?? createUserVideoRecoveryQuotaAccountant,
    confirmationSecret: deps?.confirmationSecret ?? process.env.NEXTAUTH_SECRET ?? "",
  });
}
