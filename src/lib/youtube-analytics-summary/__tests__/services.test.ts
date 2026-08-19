import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../../video-metadata/contracts";
import { createYoutubeAnalyticsSummaryService } from "../services";
import type { AnalyticsSummaryDependencies } from "../contracts";

const args = {
  credentialRef: { userId: "u1" },
  startDate: "2025-01-01",
  endDate: "2025-01-15",
};
const row = {
  date: "2025-01-01",
  views: 10,
  likes: 2,
  comments: 1,
  estimatedMinutesWatched: 5.5,
};
const base = {
  authResolver: {
    resolve: async () => ({
      credentialRef: args.credentialRef,
      accessToken: "at",
      scopeSet: new Set<string>(),
    }),
  },
  youtubeAnalyticsApi: { query: async () => [row] },
  now: () => new Date("2025-06-15T12:00:00Z"),
};
const code = async (
  deps: Partial<AnalyticsSummaryDependencies>,
  input = args,
) => {
  const result = await createYoutubeAnalyticsSummaryService({
    ...base,
    ...deps,
  })(input);
  return result.kind === "analytics-summary-error" ? result.code : result.kind;
};

test("validates date bounds and avoids downstream calls", async () => {
  let calls = 0;
  const deps = {
    authResolver: {
      resolve: async () => {
        calls++;
        return base.authResolver.resolve();
      },
    },
  };
  for (const input of [
    { ...args, startDate: "bad" },
    { ...args, startDate: "2025-02-30" },
    { ...args, startDate: "2025-02-01", endDate: "2025-01-01" },
    { ...args, startDate: "2025-01-01", endDate: "2025-02-01" },
    { ...args, startDate: "2025-06-16", endDate: "2025-06-20" },
  ])
    assert.equal(await code(deps, input), "INVALID_INPUT");
  assert.equal(
    await code({}, { ...args, endDate: "2025-01-31" }),
    "analytics-summary",
  );
  assert.equal(calls, 0);
});

test("maps auth and provider failures", async () => {
  assert.equal(
    await code({
      authResolver: {
        resolve: async () => {
          throw new DomainError({ code: "AUTH_USER_NOT_FOUND", message: "x" });
        },
      },
    }),
    "AUTH_REQUIRED",
  );
  assert.equal(
    await code({
      authResolver: {
        resolve: async () => {
          throw new DomainError({
            code: "AUTH_SCOPE_INSUFFICIENT",
            message: "x",
          });
        },
      },
    }),
    "AUTH_SCOPE_INSUFFICIENT",
  );
  assert.equal(
    await code({
      youtubeAnalyticsApi: {
        query: async () => {
          throw new Error("x");
        },
      },
    }),
    "ANALYTICS_API_ERROR",
  );
});

test("returns normalized and empty results", async () => {
  const result = await createYoutubeAnalyticsSummaryService({
    ...base,
    youtubeAnalyticsApi: { query: async () => [row] },
  })(args);
  assert.deepEqual(result.kind === "analytics-summary" && result.days, [row]);
  assert.equal(
    await code({ youtubeAnalyticsApi: { query: async () => [] } }),
    "analytics-summary",
  );
});

test("records quota for success and failure, isolating accountant errors", async () => {
  const recorded: string[] = [];
  const accountant = {
    record: ({ operation }: { operation: string }) => recorded.push(operation),
  };
  assert.equal(
    await code({ quotaAccountant: accountant }),
    "analytics-summary",
  );
  assert.equal(
    await code({
      youtubeAnalyticsApi: {
        query: async () => {
          throw new Error();
        },
      },
      quotaAccountant: accountant,
    }),
    "ANALYTICS_API_ERROR",
  );
  assert.deepEqual(recorded, ["reports.query", "reports.query"]);
  assert.equal(
    await code({
      quotaAccountant: {
        record: () => {
          throw new Error();
        },
      },
    }),
    "analytics-summary",
  );
});
