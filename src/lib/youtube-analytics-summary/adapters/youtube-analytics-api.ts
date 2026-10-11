import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/auth";
import { DomainError } from "../../video-metadata/contracts";
import type { AnalyticsQuery, DailyAnalyticsRow, YoutubeAnalyticsApi } from "../contracts";
import { dailyAnalyticsRowSchema } from "../schemas";

interface AnalyticsResponse {
  columnHeaders?: { name?: string | null }[] | null;
  rows?: unknown[][] | null;
}

interface AnalyticsClient {
  reports: {
    query(args: {
      ids: string;
      startDate: string;
      endDate: string;
      metrics: string;
      dimensions: string;
      sort: string;
    }): Promise<AnalyticsResponse | { data: AnalyticsResponse }>;
  };
}

function malformed(): DomainError {
  return new DomainError({ code: "unauthorized", message: "Malformed analytics response" });
}

function normalize(response: unknown): DailyAnalyticsRow[] {
  if (response === null || typeof response !== "object" || Array.isArray(response)) throw malformed();
  const report = response as AnalyticsResponse;
  if (report.rows != null && !Array.isArray(report.rows)) throw malformed();
  if (report.rows == null || report.rows.length === 0) return [];
  if (!Array.isArray(report.columnHeaders) || report.columnHeaders.some(
    (header) => header === null || typeof header !== "object" || Array.isArray(header),
  )) throw malformed();
  const names = report.columnHeaders.map((header) => header.name);
  const required = ["day", "views", "likes", "comments", "estimatedMinutesWatched"];
  if (!names || required.some((name) => names.indexOf(name) < 0)) throw malformed();

  return report.rows.map((row) => {
    if (!Array.isArray(row)) throw malformed();
    const parsed = dailyAnalyticsRowSchema.safeParse({
      date: row[names.indexOf("day")],
      views: row[names.indexOf("views")],
      likes: row[names.indexOf("likes")],
      comments: row[names.indexOf("comments")],
      estimatedMinutesWatched: row[names.indexOf("estimatedMinutesWatched")],
    });
    if (!parsed.success) throw malformed();
    return parsed.data;
  });
}

function authorizedClient(args: AnalyticsQuery): AnalyticsClient {
  const oauth = createGoogleOAuthClient();
  oauth.setCredentials({
    access_token: args.credentials.accessToken,
    refresh_token: args.credentials.refreshToken,
  });
  return google.youtubeAnalytics({ version: "v2", auth: oauth });
}

export function createYoutubeAnalyticsApi(
  clientFactory: (args: AnalyticsQuery) => AnalyticsClient = authorizedClient,
): YoutubeAnalyticsApi {
  return {
    async query(args) {
      let response: AnalyticsResponse | { data: AnalyticsResponse };
      try {
        response = await clientFactory(args).reports.query({
          ids: "channel==MINE",
          startDate: args.startDate,
          endDate: args.endDate,
          metrics: "views,likes,comments,estimatedMinutesWatched",
          dimensions: "day",
          sort: "day",
        });
      } catch {
        throw new DomainError({ code: "unauthorized", message: "YouTube Analytics request failed" });
      }
      // googleapis wraps the report in data; injected clients may return it directly.
      const report = response !== null && typeof response === "object" && "data" in response
        ? response.data : response;
      return normalize(report);
    },
  };
}
