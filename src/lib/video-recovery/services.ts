import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { YOUTUBE_QUOTA_COSTS, type QuotaAccountant } from "../quota/accountant";
import { DomainError, type ResolvedCredentials } from "../video-metadata/contracts";
import { mapProviderError } from "../provider-errors";
import type {
  RecoveryBatchReconcileResult,
  RecoveryCancelRequest,
  RecoveryCancelResult,
  RecoveryProvider,
  RecoveryReconcileRequest,
  RecoveryReconcileResult,
} from "./contracts";
import { recoveryBatchReconcileRequestSchema, recoveryCancelRequestSchema, recoveryReconcileRequestSchema } from "./schemas";

const CONFIRMATION_TTL_SECONDS = 600;
const RECOVERY_QUOTA_ESTIMATE = YOUTUBE_QUOTA_COSTS["videos.list"] + YOUTUBE_QUOTA_COSTS["videos.update"];

export type VideoRecoveryDependencies = {
  authResolver: { resolve(args: { credentialRef: RecoveryReconcileRequest["credentialRef"]; requiredScopes: readonly string[] }): Promise<ResolvedCredentials> };
  writeContext: { assertWriteChannel(args: { credentialRef: RecoveryReconcileRequest["credentialRef"]; credentials: ResolvedCredentials; expectedChannelId: string }): Promise<{ expectedChannelId: string }> };
  provider: RecoveryProvider;
  quotaAccountantFactory: (credentials: ResolvedCredentials) => QuotaAccountant;
  confirmationSecret: string;
  now?: () => number;
  operationIdFactory?: () => string;
};

const invalid = (message = "Invalid recovery request") => new DomainError({ code: "validation_failed", message });

function safeQuota(deps: VideoRecoveryDependencies, credentials: ResolvedCredentials): QuotaAccountant {
  try {
    const accountant = deps.quotaAccountantFactory(credentials);
    if (!accountant || typeof accountant.record !== "function") throw new Error("Unavailable");
    return accountant;
  } catch {
    throw new DomainError({ code: "validation_failed", message: "Recovery quota accounting is unavailable" });
  }
}

function recoveryOperationId(deps: VideoRecoveryDependencies): string {
  return deps.operationIdFactory?.() ?? randomUUID();
}

function cancellationIdentity(request: RecoveryCancelRequest, video: { channelId: string; privacyStatus: string; publishAt?: string | null }): string {
  return JSON.stringify([
    request.credentialRef,
    request.expectedChannelId,
    request.operationId,
    request.videoId,
    video,
    { reviewedDryRun: true },
  ]);
}

function createConfirmationToken(secret: string, expiry: number, identity: string): string {
  const signature = createHmac("sha256", secret).update(`${expiry}:${identity}`).digest("hex");
  return `${expiry}.${signature}`;
}

function validConfirmationToken(token: string | undefined, secret: string, identity: string, now: number): boolean {
  const [expiryText, signature] = token?.split(".") ?? [];
  const expiry = Number(expiryText);
  const currentSecond = Math.floor(now / 1000);
  if (!Number.isSafeInteger(expiry) || expiry < currentSecond || expiry > currentSecond + CONFIRMATION_TTL_SECONDS || !/^[a-f0-9]{64}$/.test(signature ?? "")) return false;
  const expected = createConfirmationToken(secret, expiry, identity).split(".")[1]!;
  return timingSafeEqual(Buffer.from(signature!, "hex"), Buffer.from(expected, "hex"));
}

export function createVideoRecoveryService(deps: VideoRecoveryDependencies) {
  async function context(request: RecoveryReconcileRequest) {
    const credentials = await deps.authResolver.resolve({ credentialRef: request.credentialRef, requiredScopes: ["https://www.googleapis.com/auth/youtube"] });
    const channel = await deps.writeContext.assertWriteChannel({ credentialRef: request.credentialRef, credentials, expectedChannelId: request.expectedChannelId });
    return { credentials, channel, quotaAccountant: safeQuota(deps, credentials) };
  }

  async function reconcile(input: unknown): Promise<RecoveryReconcileResult> {
    const parsed = recoveryReconcileRequestSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    const request = parsed.data;
    const { credentials, channel, quotaAccountant } = await context(request);
    const operationId = recoveryOperationId(deps);
    if (!request.videoId) return { status: "unsupported", operationId: request.operationId, reason: "provider_operation_identity_unavailable" };
    try {
      const result = await deps.provider.reconcile({
        credentials, targetOperationId: request.operationId, videoId: request.videoId,
        operationId, channelId: channel.expectedChannelId, quotaAccountant,
      });
      if (result.status === "succeeded") {
        if (result.channelId !== channel.expectedChannelId) throw new DomainError({ code: "WRITE_CHANNEL_MISMATCH", message: "Recovery channel mismatch" });
        return { status: "succeeded", operationId: request.operationId, videoId: result.videoId, channelId: result.channelId, privacyStatus: result.privacyStatus };
      }
      if (result.status === "absent") return { status: "absent", operationId: request.operationId, channelId: result.channelId };
      if (result.status === "unsupported") return { status: "unsupported", operationId: request.operationId, reason: result.reason };
      if (result.channelId !== channel.expectedChannelId) throw new DomainError({ code: "WRITE_CHANNEL_MISMATCH", message: "Recovery channel mismatch" });
      return { status: "unknown", operationId: request.operationId, channelId: result.channelId, reason: result.reason, retryAutomatically: false };
    } catch (error) {
      const mapped = mapProviderError(error, "update_failed");
      if (mapped.code === "unauthorized" || mapped.code === "validation_failed" || mapped.code.startsWith("WRITE_CHANNEL_")) throw mapped;
      return { status: "unknown", operationId: request.operationId, channelId: channel.expectedChannelId, reason: "provider_state_unavailable", retryAutomatically: false };
    }
  }

  async function reconcileMany(input: unknown): Promise<RecoveryBatchReconcileResult> {
    const parsed = recoveryBatchReconcileRequestSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    const request = parsed.data;
    const items = await Promise.all(parsed.data.items.map(async (item, index) => {
      try {
        return { index, ...(await reconcile({ credentialRef: request.credentialRef, expectedChannelId: request.expectedChannelId, operationId: item.operationId, videoId: item.videoId })) };
      } catch (error) {
        const domain = mapProviderError(error, "update_failed");
        if (domain.code === "unauthorized" || domain.code === "validation_failed" || domain.code.startsWith("WRITE_CHANNEL_")) throw domain;
        return { index, status: "unknown" as const, operationId: item.operationId, channelId: request.expectedChannelId, reason: "provider_state_unavailable", retryAutomatically: false as const };
      }
    }));
    return { status: "completed", channelId: request.expectedChannelId, items };
  }

  async function cancel(input: unknown): Promise<RecoveryCancelResult> {
    const parsed = recoveryCancelRequestSchema.safeParse(input);
    if (!parsed.success || !deps.confirmationSecret) throw invalid();
    const request = parsed.data;
    const { credentials, channel, quotaAccountant } = await context(request);
    const recoveryOperationIdValue = recoveryOperationId(deps);
    const inspect = async () => {
      try {
        const video = await deps.provider.inspect({ credentials, videoId: request.videoId, operationId: recoveryOperationIdValue, channelId: channel.expectedChannelId, quotaAccountant });
        if (!video) throw new DomainError({ code: "not_found", message: "Recovery video was not found" });
        if (video.channelId !== channel.expectedChannelId) throw new DomainError({ code: "WRITE_CHANNEL_MISMATCH", message: "Recovery channel mismatch" });
        return video;
      } catch (error) {
        throw mapProviderError(error, "update_failed");
      }
    };
    const video = await inspect();
    const identity = cancellationIdentity(request, video);
    const now = deps.now?.() ?? Date.now();
    const expiry = Math.floor(now / 1000) + CONFIRMATION_TTL_SECONDS;
    if (request.dryRun) return {
      status: "validated", operationId: request.operationId, recoveryOperationId: recoveryOperationIdValue,
      videoId: video.videoId, channelId: video.channelId, privacyStatus: video.privacyStatus, publishAt: video.publishAt,
      quotaEstimate: RECOVERY_QUOTA_ESTIMATE, confirmationToken: createConfirmationToken(deps.confirmationSecret, expiry, identity), dryRun: true,
    };
    if (request.confirmed !== true || !validConfirmationToken(request.confirmationToken, deps.confirmationSecret, identity, now)) throw invalid("A valid recovery confirmation is required");
    if (video.privacyStatus === "private" && !video.publishAt) return { status: "already_private", operationId: request.operationId, recoveryOperationId: recoveryOperationIdValue, videoId: video.videoId, channelId: video.channelId, privacyStatus: "private", dryRun: false };
    try {
      const result = await deps.provider.returnToPrivate({ credentials, videoId: video.videoId, operationId: recoveryOperationIdValue, channelId: channel.expectedChannelId, quotaAccountant });
      if (result.status === "unsupported") return { status: "unsupported", operationId: request.operationId, recoveryOperationId: recoveryOperationIdValue, videoId: video.videoId, channelId: channel.expectedChannelId, reason: result.reason, dryRun: false };
      if (result.channelId !== channel.expectedChannelId) throw new DomainError({ code: "WRITE_CHANNEL_MISMATCH", message: "Recovery channel mismatch" });
      return { status: "cancelled", operationId: request.operationId, recoveryOperationId: recoveryOperationIdValue, videoId: result.videoId, channelId: result.channelId, privacyStatus: "private", dryRun: false };
    } catch (error) {
      const mapped = mapProviderError(error, "update_failed");
      throw new DomainError({ code: mapped.code, message: mapped.message, details: { operationId: request.operationId, recoveryOperationId: recoveryOperationIdValue, outcome: "unknown", retryAutomatically: false } });
    }
  }

  return { reconcile, reconcileMany, cancel };
}
