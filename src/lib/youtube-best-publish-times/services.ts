import { YOUTUBE_ANALYTICS_READ_SCOPE } from "../auth";
import { isDomainError } from "../video-metadata/contracts";
import type { ResolvedCredentials } from "../video-metadata/contracts";
import type { QuotaAccountant } from "../quota/accountant";
import { earlyWindow, isValidTimezone, rankPublishSlots } from "./slots";
import type {
  BestPublishTimesDependencies,
  BestPublishTimesErrorCode,
  BestPublishTimesResponse,
  EarlyViewsSample,
  PublishedVideo,
} from "./contracts";

const METHOD = {
  maxVideos: 50,
  minVideoAgeDays: 4,
  earlyWindowDays: 3,
  slotHours: 3,
  minSlotSamples: 2,
} as const;
const MIN_NORMAL_CONFIDENCE_VIDEOS = 10;
const EARLY_VIEWS_CONCURRENCY = 5;
const DAY_MS = 86_400_000;

const error = (
  code: BestPublishTimesErrorCode,
  message: string,
  requiredScopes?: ["yt-analytics.readonly"],
): BestPublishTimesResponse => ({
  kind: "best-publish-times-error",
  code,
  message,
  ...(requiredScopes ? { requiredScopes } : {}),
});

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function createBestPublishTimesService(deps: BestPublishTimesDependencies) {
  const now = deps.now ?? (() => new Date());
  return async (args: {
    credentialRef: unknown;
    timezone: string;
  }): Promise<BestPublishTimesResponse> => {
    if (!isValidTimezone(args.timezone))
      return error("INVALID_INPUT", "timezone must be a valid IANA timezone");
    let credentials: ResolvedCredentials;
    try {
      credentials = await deps.authResolver.resolve({
        credentialRef: args.credentialRef,
        requiredScopes: [YOUTUBE_ANALYTICS_READ_SCOPE],
      });
    } catch (err) {
      return isDomainError(err) && err.code === "AUTH_SCOPE_INSUFFICIENT"
        ? error(
            "AUTH_SCOPE_INSUFFICIENT",
            "Reauthorization with the yt-analytics.readonly scope is required.",
            ["yt-analytics.readonly"],
          )
        : error("AUTH_REQUIRED", "Authentication required");
    }
    const accountant: QuotaAccountant | undefined =
      deps.quotaAccountantFactory?.(credentials) ?? deps.quotaAccountant;
    const operationId = deps.operationIdFactory?.() ?? `op-${Date.now()}`;
    const recordReportQuery = () => {
      try {
        accountant?.record({ operationId, operation: "reports.query" });
      } catch {
        /* accounting is isolated */
      }
    };

    try {
      const listed = await deps.api.listRecentVideos({
        credentials,
        maxVideos: METHOD.maxVideos,
        quota: { operationId, quotaAccountant: accountant },
      });
      // The early window is only complete once the video is old enough.
      const cutoff = now().getTime() - METHOD.minVideoAgeDays * DAY_MS;
      const eligible = listed.filter((video: PublishedVideo) => {
        const publishedMs = Date.parse(video.publishedAt);
        return Number.isFinite(publishedMs) && publishedMs <= cutoff;
      });
      const samples = await mapWithConcurrency(
        eligible,
        EARLY_VIEWS_CONCURRENCY,
        async (video): Promise<EarlyViewsSample> => {
          try {
            const earlyViews = await deps.api.queryEarlyViews({
              credentials,
              videoId: video.videoId,
              ...earlyWindow(video.publishedAt),
            });
            return { ...video, earlyViews };
          } finally {
            recordReportQuery();
          }
        },
      );
      const { channelMedianEarlyViews, slots } = rankPublishSlots(samples, args.timezone, {
        slotHours: METHOD.slotHours,
        minSlotSamples: METHOD.minSlotSamples,
      });
      return {
        kind: "best-publish-times",
        timezone: args.timezone,
        analyzedVideos: samples.length,
        excludedVideos: listed.length - samples.length,
        channelMedianEarlyViews,
        confidence:
          samples.length < MIN_NORMAL_CONFIDENCE_VIDEOS || slots.length === 0 ? "low" : "normal",
        slots,
        method: { ...METHOD },
      };
    } catch {
      return error("ANALYTICS_API_ERROR", "YouTube Analytics request failed");
    }
  };
}
