import { randomUUID } from "node:crypto";
import { YOUTUBE_ANALYTICS_READ_SCOPE } from "../auth";
import type { QuotaAccountant } from "../quota/accountant";
import { isDomainError, type ResolvedCredentials } from "../video-metadata/contracts";
import type {
  AnalyticsSummaryRequest,
  AnalyticsSummaryResponse,
  YoutubeAnalyticsApi,
} from "./contracts";

interface ServiceDependencies {
  authResolver: {
    resolve(args: {
      credentialRef: AnalyticsSummaryRequest["credentialRef"];
      requiredScopes: readonly string[];
    }): Promise<ResolvedCredentials>;
  };
  youtubeAnalyticsApi: YoutubeAnalyticsApi;
  quotaAccountant?: QuotaAccountant;
  operationIdFactory?: () => string;
  now?: () => Date;
}

const DAY_MS = 86_400_000;

function utcDay(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return timestamp;
}

export function createYoutubeAnalyticsSummaryService(deps: ServiceDependencies) {
  return async (input: AnalyticsSummaryRequest): Promise<AnalyticsSummaryResponse> => {
    const start = utcDay(input?.startDate);
    const end = utcDay(input?.endDate);
    const today = deps.now?.() ?? new Date();
    const currentDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (start === null || end === null || end < start || end > currentDay || (end - start) / DAY_MS >= 31) {
      return { kind: "analytics-summary-error", code: "INVALID_INPUT", message: "Date range must contain 1–31 valid UTC calendar days and cannot be in the future" };
    }

    let credentials: ResolvedCredentials;
    try {
      credentials = await deps.authResolver.resolve({
        credentialRef: input.credentialRef,
        requiredScopes: [YOUTUBE_ANALYTICS_READ_SCOPE],
      });
    } catch (error) {
      if (isDomainError(error) && error.code === "AUTH_SCOPE_INSUFFICIENT") {
        return {
          kind: "analytics-summary-error", code: "AUTH_SCOPE_INSUFFICIENT",
          message: "Reauthorize Google with YouTube Analytics read access.",
          requiredScopes: ["yt-analytics.readonly"],
        };
      }
      return { kind: "analytics-summary-error", code: "AUTH_REQUIRED", message: "YouTube authorization is required" };
    }

    let result: AnalyticsSummaryResponse;
    try {
      const days = await deps.youtubeAnalyticsApi.query({ credentials, startDate: input.startDate, endDate: input.endDate });
      result = { kind: "analytics-summary", startDate: input.startDate, endDate: input.endDate, days };
    } catch {
      result = { kind: "analytics-summary-error", code: "ANALYTICS_API_ERROR", message: "YouTube Analytics request failed" };
    } finally {
      if (deps.quotaAccountant) {
        let operationId = "reports.query-fallback";
        try {
          const generated = deps.operationIdFactory?.() ?? randomUUID();
          if (generated) operationId = generated;
        } catch {
          try {
            operationId = randomUUID();
          } catch {
            // Retain a nonempty ID so accounting is still attempted.
          }
        }
        try {
          await deps.quotaAccountant.record({ operationId, operation: "reports.query" });
        } catch {
          // Accounting must not change the provider result.
        }
      }
    }
    return result;
  };
}
