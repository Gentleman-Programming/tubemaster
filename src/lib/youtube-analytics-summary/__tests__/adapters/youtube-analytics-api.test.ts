import assert from "node:assert/strict";
import test from "node:test";
import { createYoutubeAnalyticsApi } from "../../adapters/youtube-analytics-api";
import { DomainError } from "../../../video-metadata/contracts";

const credentials = {
  credentialRef: { userId: "u1" },
  accessToken: "at",
  scopeSet: new Set<string>(),
};
type Mock = {
  args?: Record<string, unknown>;
  response?: { rows?: unknown[][] | null; columnHeaders?: { name: string }[] };
};
const call = (result: Mock) => () => ({
  reports: {
    query: async (args: Record<string, unknown>) => {
      result.args = args;
      return result.response ?? {};
    },
  },
});
const query = { credentials, startDate: "2025-01-01", endDate: "2025-01-15" };

test("uses exact reports.query parameters and normalizes rows", async () => {
  const result: Mock = {
    response: {
      columnHeaders: [
        { name: "day" },
        { name: "views" },
        { name: "likes" },
        { name: "comments" },
        { name: "estimatedMinutesWatched" },
      ],
      rows: [["2025-01-01", "10", "2", "1", "5.5"]],
    },
  };
  const rows = await createYoutubeAnalyticsApi(call(result)).query(query);
  assert.deepEqual(result.args, {
    ids: "channel==MINE",
    startDate: query.startDate,
    endDate: query.endDate,
    metrics: "views,likes,comments,estimatedMinutesWatched",
    dimensions: "day",
    sort: "day",
  });
  assert.deepEqual(rows, [
    {
      date: "2025-01-01",
      views: 10,
      likes: 2,
      comments: 1,
      estimatedMinutesWatched: 5.5,
    },
  ]);
});

test("normalizes missing rows to empty and rejects provider errors", async () => {
  assert.deepEqual(
    await createYoutubeAnalyticsApi(call({ response: { rows: null } })).query(
      query,
    ),
    [],
  );
  await assert.rejects(
    () =>
      createYoutubeAnalyticsApi(() => ({
        reports: {
          query: async () => {
            throw new Error("provider");
          },
        },
      })).query(query),
    (e: unknown) => e instanceof DomainError,
  );
});

test("sanitizes 403, 5xx, and network provider failures", async () => {
  for (const failure of [
    Object.assign(new Error("forbidden secret"), { response: { status: 403 } }),
    Object.assign(new Error("server secret"), { response: { status: 503 } }),
    new Error("network secret"),
  ]) {
    await assert.rejects(
      () =>
        createYoutubeAnalyticsApi(() => ({
          reports: {
            query: async () => {
              throw failure;
            },
          },
        })).query(query),
      (e: unknown) => {
        assert.ok(e instanceof DomainError);
        assert.equal(e.code, "unauthorized");
        assert.equal(e.message, "YouTube Analytics request failed");
        assert.equal(e.details, undefined);
        assert.equal(e.message.includes("secret"), false);
        return true;
      },
    );
  }
});
