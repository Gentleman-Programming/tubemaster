import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsRetentionGetHandler } from "../route";
import type { AnalyticsRetentionResponse } from "@/lib/youtube-analytics-summary";

const session = async () => ({ user: { id: "u1" } });
const url = (videoId = "video-1") => new URL(`http://x/api/youtube/analytics/retention?videoId=${videoId}&startDate=2026-01-01&endDate=2026-01-31`);
const handler = (result: AnalyticsRetentionResponse, getSession: () => Promise<{ user?: { id?: string | null } } | null> = session) => createAnalyticsRetentionGetHandler({ getSession, core: { fetchAnalyticsRetention: async () => result } });

test("requires authentication and a selected video", async () => {
  assert.equal((await handler({ kind: "analytics-retention-error", code: "AUTH_REQUIRED", message: "Authentication required" }, async () => null)(url())).status, 401);
  assert.equal((await handler({ kind: "analytics-retention-error", code: "INVALID_INPUT", message: "Invalid videoId or date range" })(url(""))).status, 422);
});

test("returns retention rows and provider errors with mapped statuses", async () => {
  const success = await handler({ kind: "analytics-retention", videoId: "video-1", rows: [] })(url());
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { kind: "analytics-retention", videoId: "video-1", rows: [] });
  assert.equal((await handler({ kind: "analytics-retention-error", code: "ANALYTICS_API_ERROR", message: "YouTube Analytics request failed" })(url())).status, 502);
});
