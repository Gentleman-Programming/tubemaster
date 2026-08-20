import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsGetHandler } from "../route";
import type {
  AnalyticsSummaryResponse,
  AnalyticsSummaryErrorCode,
} from "@/lib/youtube-analytics-summary";

const url = new URL(
  "http://x/api/youtube/analytics?startDate=2025-01-01&endDate=2025-01-15",
);
const session = async () => ({ user: { id: "u1" } });
const handler = (
  result: AnalyticsSummaryResponse,
  getSession: () => Promise<{ user?: { id?: string | null } } | null> = session,
) =>
  createAnalyticsGetHandler({
    getSession,
    core: { fetchAnalyticsSummary: async () => result },
  });
const error = (
  code: AnalyticsSummaryErrorCode,
  requiredScopes?: ["yt-analytics.readonly"],
) => ({
  kind: "analytics-summary-error" as const,
  code,
  message: "error",
  ...(requiredScopes ? { requiredScopes } : {}),
});

test("maps auth, validation, scope, provider and success statuses", async () => {
  assert.equal(
    (await handler(error("AUTH_REQUIRED"), async () => null)(url)).status,
    401,
  );
  assert.equal((await handler(error("INVALID_INPUT"))(url)).status, 422);
  const forbidden = await handler(
    error("AUTH_SCOPE_INSUFFICIENT", ["yt-analytics.readonly"]),
  )(url);
  assert.equal(forbidden.status, 403);
  assert.deepEqual((await forbidden.json()).requiredScopes, [
    "yt-analytics.readonly",
  ]);
  assert.equal((await handler(error("ANALYTICS_API_ERROR"))(url)).status, 502);
  assert.equal(
    (
      await handler({
        kind: "analytics-summary",
        startDate: "2025-01-01",
        endDate: "2025-01-15",
        days: [],
      })(url)
    ).status,
    200,
  );
});

test("sanitizes unexpected core exceptions with a 500 response", async () => {
  const response = await createAnalyticsGetHandler({
    getSession: session,
    core: {
      fetchAnalyticsSummary: async () => {
        throw new Error("sensitive provider details");
      },
    },
  })(url);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    kind: "analytics-summary-error",
    code: "ANALYTICS_API_ERROR",
    message: "Internal error",
  });
});
