import { YOUTUBE_ANALYTICS_READ_SCOPE } from "../auth";
import { isDomainError } from "../video-metadata/contracts";
import type { ResolvedCredentials } from "../video-metadata/contracts";
import type { QuotaAccountant } from "../quota/accountant";
import { analyticsSummaryInputSchema } from "./schemas";
import type {
  AnalyticsSummaryDependencies,
  AnalyticsSummaryResponse,
} from "./contracts";

const error = (
  code:
    | "INVALID_INPUT"
    | "AUTH_REQUIRED"
    | "AUTH_SCOPE_INSUFFICIENT"
    | "ANALYTICS_API_ERROR",
  message: string,
  requiredScopes?: ["yt-analytics.readonly"],
): AnalyticsSummaryResponse => ({
  kind: "analytics-summary-error",
  code,
  message,
  ...(requiredScopes ? { requiredScopes } : {}),
});
const invalid = (start: string, end: string, now: () => Date) => {
  if (
    !analyticsSummaryInputSchema.safeParse({ startDate: start, endDate: end })
      .success
  )
    return "Invalid date format";
  const parse = (v: string) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return d.getUTCFullYear() === +v.slice(0, 4) &&
      d.getUTCMonth() + 1 === +v.slice(5, 7) &&
      d.getUTCDate() === +v.slice(8, 10)
      ? d
      : null;
  };
  const s = parse(start),
    e = parse(end);
  if (!s || !e) return "Invalid date";
  if (s > e) return "startDate must be <= endDate";
  if ((e.getTime() - s.getTime()) / 86400000 + 1 > 90)
    return "Range exceeds 90 days";
  const today = new Date(now().getTime());
  today.setUTCHours(0, 0, 0, 0);
  if (s > today || e > today) return "Future date";
  return null;
};

export function createYoutubeAnalyticsSummaryService(
  deps: AnalyticsSummaryDependencies,
) {
  const now = deps.now ?? (() => new Date());
  return async (args: {
    credentialRef: unknown;
    startDate: string;
    endDate: string;
  }): Promise<AnalyticsSummaryResponse> => {
    const dateError = invalid(args.startDate, args.endDate, now);
    if (dateError) return error("INVALID_INPUT", dateError);
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
    try {
      const days = await deps.youtubeAnalyticsApi.query({
        credentials,
        startDate: args.startDate,
        endDate: args.endDate,
      });
      return {
        kind: "analytics-summary",
        startDate: args.startDate,
        endDate: args.endDate,
        days,
      };
    } catch {
      return error("ANALYTICS_API_ERROR", "YouTube Analytics request failed");
    } finally {
      try {
        accountant?.record({ operationId, operation: "reports.query" });
      } catch {
        /* accounting is isolated */
      }
    }
  };
}
