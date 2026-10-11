import assert from "node:assert/strict";
import test from "node:test";
import type {
  AnalyticsSummaryRequest,
  AnalyticsSummaryResponse,
} from "@/lib/youtube-analytics-summary";
import { createAnalyticsGetHandler } from "./route";

const success: AnalyticsSummaryResponse = {
  kind: "analytics-summary",
  startDate: "2025-01-01",
  endDate: "2025-01-02",
  days: [
    {
      date: "2025-01-01",
      views: 10,
      likes: 2,
      comments: 1,
      estimatedMinutesWatched: 20,
    },
  ],
};

const dates = "startDate=2025-01-01&endDate=2025-01-02";
const request = (query: string) =>
  new Request(`http://localhost/api/youtube/analytics?${query}`);

function makeDeps(options: {
  session?: { user?: { id?: string | null } } | null;
  service?: (input: AnalyticsSummaryRequest) => Promise<AnalyticsSummaryResponse>;
}) {
  return {
    getSession: async () =>
      options.session === undefined ? { user: { id: "user-1" } } : options.session,
    service: options.service ?? (async () => success),
  } as unknown as Parameters<typeof createAnalyticsGetHandler>[0];
}

test("analytics requires a session before invoking the service", async () => {
  let calls = 0;
  const response = await createAnalyticsGetHandler(makeDeps({
    session: null,
    service: async () => { calls++; return success; },
  }))(request(dates));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    kind: "analytics-summary-error",
    code: "AUTH_REQUIRED",
    message: "YouTube authorization is required",
  });
  assert.equal(calls, 0);
});

test("analytics rejects any caller-supplied channelId, including an empty value", async () => {
  for (const channelId of ["channel-1", ""]) {
    let calls = 0;
    const response: Response = await createAnalyticsGetHandler(makeDeps({
      service: async (): Promise<AnalyticsSummaryResponse> => { calls++; return success; },
    }))(request(`${dates}&channelId=${channelId}`));

    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.kind, "analytics-summary-error");
    assert.equal(payload.code, "INVALID_INPUT");
    assert.equal(typeof payload.message, "string");
    assert.equal(calls, 0);
  }
});

test("analytics passes dates and authenticated user credential reference to service", async () => {
  const inputs: AnalyticsSummaryRequest[] = [];
  const response = await createAnalyticsGetHandler(makeDeps({
    service: async (input) => { inputs.push(input); return success; },
  }))(request(dates));

  assert.equal(response.status, 200);
  assert.deepEqual(inputs, [{
    credentialRef: { userId: "user-1" },
    startDate: "2025-01-01",
    endDate: "2025-01-02",
  }]);
  assert.deepEqual(await response.json(), success);
});

test("analytics maps invalid input to typed 422", async () => {
  const response = await createAnalyticsGetHandler(makeDeps({
    service: async () => ({
      kind: "analytics-summary-error",
      code: "INVALID_INPUT",
      message: "Invalid date range",
    }),
  }))(request(dates));

  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    kind: "analytics-summary-error",
    code: "INVALID_INPUT",
    message: "Invalid date range",
  });
});

test("analytics maps insufficient scope to reauthorization guidance and 403", async () => {
  const payload: AnalyticsSummaryResponse = {
    kind: "analytics-summary-error",
    code: "AUTH_SCOPE_INSUFFICIENT",
    message: "Reauthorize Google with YouTube Analytics read access.",
    requiredScopes: ["yt-analytics.readonly"],
  };
  const response = await createAnalyticsGetHandler(makeDeps({
    service: async () => payload,
  }))(request(dates));

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), payload);
});

test("analytics maps provider failure to a sanitized stable 502", async () => {
  const secret = "provider token secret-token for user@example.com";
  const response = await createAnalyticsGetHandler(makeDeps({
    service: async () => ({
      kind: "analytics-summary-error",
      code: "ANALYTICS_API_ERROR",
      message: secret,
    }),
  }))(request(dates));

  assert.equal(response.status, 502);
  const payload = await response.json();
  assert.deepEqual(payload, {
    kind: "analytics-summary-error",
    code: "ANALYTICS_API_ERROR",
    message: "YouTube Analytics request failed",
  });
  assert.equal(JSON.stringify(payload).includes(secret), false);
});

test("analytics sanitizes session lookup failures before invoking the service", async () => {
  const secret = "session token secret-token for user@example.com";
  let calls = 0;
  const response: Response = await createAnalyticsGetHandler({
    getSession: async () => { throw new Error(secret); },
    service: async (): Promise<AnalyticsSummaryResponse> => { calls++; return success; },
  })(request(dates));

  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.deepEqual(payload, {
    kind: "analytics-summary-error",
    code: "ANALYTICS_API_ERROR",
    message: "YouTube Analytics request failed",
  });
  assert.equal(JSON.stringify(payload).includes(secret), false);
  assert.equal(calls, 0);
});

test("analytics sanitizes unexpected thrown errors", async () => {
  const secret = "provider token secret-token for user@example.com";
  const response = await createAnalyticsGetHandler(makeDeps({
    service: async () => { throw new Error(secret); },
  }))(request(dates));

  assert.equal(response.status, 500);
  const payload = await response.json();
  assert.equal(payload.kind, "analytics-summary-error");
  assert.equal(typeof payload.code, "string");
  assert.equal(typeof payload.message, "string");
  assert.equal(JSON.stringify(payload).includes(secret), false);
});
