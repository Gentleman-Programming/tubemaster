import assert from "node:assert/strict";
import test from "node:test";
import { createYoutubeAnalyticsApi } from "../../adapters/youtube-analytics-api";
import { DomainError } from "../../../video-metadata/contracts";

const credentials = {
  credentialRef: { userId: "u1" },
  accessToken: "test-access-token-never-expose",
  scopeSet: new Set<string>(),
};
const query = {
  credentials,
  startDate: "2025-01-03",
  endDate: "2025-01-15",
};
type Response = {
  rows?: unknown[][] | null;
  columnHeaders?: { name: string }[];
};
function adapter(response: unknown, capture?: (args: Record<string, unknown>) => void) {
  return createYoutubeAnalyticsApi(() => ({
    reports: {
      query: async (args: Record<string, unknown>) => {
        capture?.(args);
        return response as Response;
      },
    },
  }));
}

test("queries the caller's date range with fixed daily Analytics parameters", async () => {
  let received: Record<string, unknown> | undefined;
  await adapter({ rows: [] }, (args) => { received = args; }).query(query);
  assert.deepEqual(received, {
    ids: "channel==MINE",
    startDate: "2025-01-03",
    endDate: "2025-01-15",
    metrics: "views,likes,comments,estimatedMinutesWatched",
    dimensions: "day",
    sort: "day",
  });
});

test("maps reordered response headers to stable numeric daily rows", async () => {
  const rows = await adapter({
    columnHeaders: [
      { name: "likes" },
      { name: "estimatedMinutesWatched" },
      { name: "day" },
      { name: "comments" },
      { name: "views" },
    ],
    rows: [
      ["2", "5.5", "2025-01-03", "1", "10"],
      [0, 0, "2025-01-04", 0, 0],
    ],
  }).query(query);
  assert.deepEqual(rows, [
    { date: "2025-01-03", views: 10, likes: 2, comments: 1, estimatedMinutesWatched: 5.5 },
    { date: "2025-01-04", views: 0, likes: 0, comments: 0, estimatedMinutesWatched: 0 },
  ]);
});

test("accepts successful responses with no rows", async () => {
  for (const response of [{ rows: [] }, { rows: null }, {}]) {
    assert.deepEqual(await adapter(response).query(query), []);
  }
});

test("rejects malformed response rows without exposing provider data", async () => {
  for (const response of [
    { columnHeaders: [{ name: "day" }], rows: [["2025-01-03"]] },
    {
      columnHeaders: ["day", "views", "likes", "comments", "estimatedMinutesWatched"].map((name) => ({ name })),
      rows: [["2025-01-03", "private-provider-payload", 2, 1, 5]],
    },
  ]) {
    await assert.rejects(() => adapter(response).query(query), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, "unauthorized");
      assert.equal(error.message, "Malformed analytics response");
      assert.equal(error.details, undefined);
      return true;
    });
  }
});

test("sanitizes malformed runtime provider payloads", async () => {
  for (const response of [
    null,
    "private-provider-payload",
    { rows: "private-provider-payload" },
    { rows: ["private-provider-payload"], columnHeaders: null },
    { rows: [["2025-01-03"]], columnHeaders: [null] },
    { rows: [["2025-01-03"]], columnHeaders: "private-provider-payload" },
  ]) {
    await assert.rejects(() => adapter(response).query(query), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, "unauthorized");
      assert.equal(error.message, "Malformed analytics response");
      assert.equal(error.details, undefined);
      assert.equal(JSON.stringify(error).includes("private-provider-payload"), false);
      return true;
    });
  }
});

test("sanitizes forbidden, server, and network provider failures", async () => {
  for (const failure of [
    Object.assign(new Error("private-provider-payload"), { response: { status: 403 } }),
    Object.assign(new Error("private-provider-payload"), { response: { status: 503 } }),
    new Error("private-provider-payload"),
  ]) {
    const api = createYoutubeAnalyticsApi(() => ({
      reports: { query: async () => { throw failure; } },
    }));
    await assert.rejects(() => api.query(query), (error: unknown) => {
      assert.ok(error instanceof DomainError);
      assert.equal(error.code, "unauthorized");
      assert.equal(error.message, "YouTube Analytics request failed");
      assert.equal(error.details, undefined);
      assert.equal(JSON.stringify(error).includes("private-provider-payload"), false);
      assert.equal(JSON.stringify(error).includes(credentials.accessToken), false);
      return true;
    });
  }
});
