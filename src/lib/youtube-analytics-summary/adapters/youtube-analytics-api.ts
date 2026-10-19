import { createGoogleOAuthClient } from "../../auth";
import { DomainError } from "../../video-metadata/contracts";
import type { ResolvedCredentials } from "../../video-metadata/contracts";
import type {
  AnalyticsDayRow,
  AnalyticsMetricRow,
  AnalyticsTrafficSourceRow,
} from "../contracts";

type Response = {
  rows?: unknown[][] | null;
  columnHeaders?: { name: string }[];
};
type ProviderResponse = Response | { data: unknown };
type QueryArgs = {
  credentials: ResolvedCredentials;
  startDate: string;
  endDate: string;
};

function responseData(response: ProviderResponse): Response {
  return "data" in response ? (response.data as Response) : response;
}
const baseParams = (startDate: string, endDate: string) => ({
  ids: "channel==MINE",
  startDate,
  endDate,
  metrics: "views,likes,comments,estimatedMinutesWatched",
});
const dayParams = (startDate: string, endDate: string) => ({
  ...baseParams(startDate, endDate),
  dimensions: "day",
  sort: "day",
});
const trafficSourceParams = (startDate: string, endDate: string) => ({
  ...baseParams(startDate, endDate),
  metrics: "views,estimatedMinutesWatched",
  dimensions: "insightTrafficSourceType",
  sort: "-views",
});

export function createYoutubeAnalyticsApi(
  factory?: () => {
    reports: { query(args: Record<string, unknown>): Promise<ProviderResponse> };
  },
) {
  const request = async (args: QueryArgs, params: Record<string, unknown>) => {
    if (factory) return factory().reports.query(params);
    const { google } = await import("googleapis");
    const oauth2 = createGoogleOAuthClient();
    oauth2.setCredentials({
      access_token: args.credentials.accessToken,
      refresh_token: args.credentials.refreshToken,
    });
    return google.youtubeAnalytics({ version: "v2", auth: oauth2 }).reports.query(params);
  };
  const normalize = <T>(
    response: ProviderResponse,
    dimension: string,
    mapRow: (value: (name: string) => unknown, row: unknown[]) => T,
  ): T[] => {
    const data = responseData(response);
    const headers = new Map(
      (data.columnHeaders ?? []).map((h, i) => [h.name, i]),
    );
    return (data.rows ?? []).map((row) => {
      const value = (name: string) => row[headers.get(name) ?? -1];
      if (!headers.has(dimension))
        throw new DomainError({
          code: "unauthorized",
          message: "Malformed analytics response",
        });
      return mapRow(value, row);
    });
  };
  const metrics = (value: (name: string) => unknown): AnalyticsMetricRow => {
    const views = Number(value("views"));
    const likes = Number(value("likes"));
    const comments = Number(value("comments"));
    const estimatedMinutesWatched = Number(value("estimatedMinutesWatched"));
    if (![views, likes, comments, estimatedMinutesWatched].every(Number.isFinite))
      throw new DomainError({
        code: "unauthorized",
        message: "Malformed analytics response",
      });
    return { views, likes, comments, estimatedMinutesWatched };
  };
  const run = async <T>(
    args: QueryArgs,
    params: Record<string, unknown>,
    dimension: string,
    mapRow: (value: (name: string) => unknown, row: unknown[]) => T,
  ): Promise<T[]> => {
    try {
      return normalize(await request(args, params), dimension, mapRow);
    } catch (err) {
      if (err instanceof DomainError) throw err;
      throw new DomainError({
        code: "unauthorized",
        message: "YouTube Analytics request failed",
      });
    }
  };
  return {
    query(args: QueryArgs): Promise<AnalyticsDayRow[]> {
      return run(args, dayParams(args.startDate, args.endDate), "day", (value) => {
        const rawDate = value("day");
        const date = String(rawDate ?? "");
        if (!date) throw new DomainError({ code: "unauthorized", message: "Malformed analytics response" });
        return { date, ...metrics(value) };
      });
    },
    queryTrafficSources(args: QueryArgs): Promise<AnalyticsTrafficSourceRow[]> {
      return run(
        args,
        trafficSourceParams(args.startDate, args.endDate),
        "insightTrafficSourceType",
        (value) => {
          const rawSourceType = value("insightTrafficSourceType");
          const sourceType = String(rawSourceType ?? "");
          if (!sourceType)
            throw new DomainError({ code: "unauthorized", message: "Malformed analytics response" });
          const views = Number(value("views"));
          const estimatedMinutesWatched = Number(value("estimatedMinutesWatched"));
          if (![views, estimatedMinutesWatched].every(Number.isFinite))
            throw new DomainError({ code: "unauthorized", message: "Malformed analytics response" });
          return { sourceType, views, estimatedMinutesWatched };
        },
      );
    },
  };
}
