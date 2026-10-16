import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { YOUTUBE_WRITE_SCOPE } from "../auth";
import { DomainError, type ResolvedCredentials } from "../video-metadata/contracts";
import { mapProviderError } from "../provider-errors";
import { YOUTUBE_QUOTA_COSTS, type QuotaAccountant } from "../quota/accountant";
import type { ScheduleProvider, ScheduleRequest, ScheduleResult, ScheduleVideo } from "./contracts";
import { scheduleRequestSchema, toUnambiguousUtc } from "./schemas";

export type SchedulingDependencies = {
  authResolver: { resolve(args: { credentialRef: ScheduleRequest["credentialRef"]; requiredScopes: readonly string[] }): Promise<ResolvedCredentials> };
  writeContext: { assertWriteChannel(args: { credentialRef: ScheduleRequest["credentialRef"]; credentials: ResolvedCredentials; expectedChannelId: string }): Promise<{ expectedChannelId: string }> };
  provider: ScheduleProvider;
  quotaAccountantFactory: (credentials: ResolvedCredentials) => QuotaAccountant;
  confirmationSecret: string;
  now?: () => number;
  operationIdFactory?: () => string;
};
const invalid = () => new DomainError({ code: "validation_failed", message: "Invalid scheduling request" });

export function createVideoSchedulingService(deps: SchedulingDependencies) {
  return async function schedule(input: unknown): Promise<ScheduleResult> {
    const parsed = scheduleRequestSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    const request = parsed.data;
    const publishAtUtc = toUnambiguousUtc(request.publishAt, request.timezone);
    const now = deps.now?.() ?? Date.now();
    if (!publishAtUtc || Date.parse(publishAtUtc) <= now) throw invalid();
    const credentials = await deps.authResolver.resolve({ credentialRef: request.credentialRef, requiredScopes: [YOUTUBE_WRITE_SCOPE] });
    const channel = await deps.writeContext.assertWriteChannel({ credentialRef: request.credentialRef, credentials, expectedChannelId: request.expectedChannelId });
    const operationId = deps.operationIdFactory?.() ?? randomUUID();
    let quotaAccountant: QuotaAccountant;
    try {
      quotaAccountant = deps.quotaAccountantFactory(credentials);
      if (typeof quotaAccountant?.record !== "function" || !deps.confirmationSecret) throw new Error("Unavailable");
    } catch { throw new DomainError({ code: "validation_failed", message: "Scheduling prerequisites unavailable" }); }
    let video: ScheduleVideo | null;
    try {
      video = await deps.provider.inspect({ credentials, videoId: request.videoId, operationId, channelId: channel.expectedChannelId, quotaAccountant });
    } catch (error) { throw mapProviderError(error, "update_failed"); }
    if (!video || video.channelId !== channel.expectedChannelId || video.privacyStatus !== "private" || video.publishAt) throw invalid();
    // Token binds the preview to the caller, exact request, current video state and a short expiry.
    const expires = Math.floor(now / 1000) + 600;
    const identity = JSON.stringify([request.credentialRef, request.videoId, channel.expectedChannelId, request.timezone, request.publishAt, publishAtUtc, video]);
    const sign = (expiry: number) => createHmac("sha256", deps.confirmationSecret).update(`${expiry}:${identity}`).digest("hex");
    if (request.dryRun) return {
      status: "validated", operationId, videoId: request.videoId, channelId: channel.expectedChannelId,
      publishAtUtc, quotaEstimate: YOUTUBE_QUOTA_COSTS["videos.update"] + YOUTUBE_QUOTA_COSTS["videos.list"], dryRun: true,
      confirmationToken: `${expires}.${sign(expires)}`,
    };
    const [expiryText, signature] = request.confirmationToken?.split(".") ?? [];
    const expiry = Number(expiryText);
    if (request.confirmed !== true || !Number.isSafeInteger(expiry) || expiry < Math.floor(now / 1000) || expiry > expires ||
      !signature || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(expiry), "hex"))) throw invalid();
    if (Date.parse(publishAtUtc) <= (deps.now?.() ?? Date.now())) throw invalid();
    try {
      await deps.provider.schedule({ credentials, videoId: request.videoId, publishAtUtc, operationId, channelId: channel.expectedChannelId, quotaAccountant });
    } catch (error) {
      const mapped = mapProviderError(error, "update_failed");
      throw new DomainError({ code: mapped.code, message: mapped.message, details: { operationId, outcome: "unknown", retryAutomatically: false } });
    }
    return { status: "scheduled", operationId, videoId: request.videoId, channelId: channel.expectedChannelId,
      publishAtUtc, quotaEstimate: YOUTUBE_QUOTA_COSTS["videos.update"] + YOUTUBE_QUOTA_COSTS["videos.list"], dryRun: false };
  };
}
