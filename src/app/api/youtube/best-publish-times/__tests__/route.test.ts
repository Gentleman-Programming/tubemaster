import assert from "node:assert/strict";
import test from "node:test";
import { createBestPublishTimesGetHandler } from "../route";
import type {
  BestPublishTimesResponse,
  BestPublishTimesResult,
  BestPublishTimesErrorCode,
} from "@/lib/youtube-best-publish-times";

const url = new URL(
  "http://x/api/youtube/best-publish-times?timezone=America%2FArgentina%2FBuenos_Aires",
);
const session = async () => ({ user: { id: "u1" } });
type Session = { user?: { id?: string | null } } | null;
type CoreArgs = { credentialRef: { userId: string }; timezone: string };

const handler = (
  result: BestPublishTimesResponse,
  getSession: () => Promise<Session> = session,
  calls: CoreArgs[] = [],
) =>
  createBestPublishTimesGetHandler({
    getSession,
    core: {
      fetchBestPublishTimes: async (args) => {
        calls.push(args);
        return result;
      },
    },
  });
const error = (
  code: BestPublishTimesErrorCode | "UNEXPECTED",
  requiredScopes?: ["yt-analytics.readonly"],
) =>
  ({
    kind: "best-publish-times-error" as const,
    code,
    message: "error",
    ...(requiredScopes ? { requiredScopes } : {}),
  }) as BestPublishTimesResponse;

const success: BestPublishTimesResult = {
  kind: "best-publish-times",
  timezone: "America/Argentina/Buenos_Aires",
  analyzedVideos: 12,
  excludedVideos: 1,
  channelMedianEarlyViews: 100,
  confidence: "normal",
  slots: [
    {
      weekday: "friday",
      startHour: 18,
      endHour: 21,
      score: 1.5,
      sampleSize: 3,
      medianEarlyViews: 150,
    },
  ],
  method: {
    maxVideos: 50,
    minVideoAgeDays: 4,
    earlyWindowDays: 2,
    slotHours: 3,
    minSlotSamples: 2,
  },
};

test("returns 401 without a session and never calls the core", async () => {
  const calls: CoreArgs[] = [];
  const response = await handler(success, async () => null, calls)(url);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    kind: "best-publish-times-error",
    code: "AUTH_REQUIRED",
    message: "Authentication required",
  });
  assert.equal(calls.length, 0);
});

test("passes the session userId and timezone to the core", async () => {
  const calls: CoreArgs[] = [];
  await handler(success, session, calls)(url);

  assert.deepEqual(calls, [
    {
      credentialRef: { userId: "u1" },
      timezone: "America/Argentina/Buenos_Aires",
    },
  ]);
});

test("defaults a missing timezone to an empty string", async () => {
  const calls: CoreArgs[] = [];
  await handler(success, session, calls)(
    new URL("http://x/api/youtube/best-publish-times"),
  );

  assert.equal(calls[0]?.timezone, "");
});

test("returns 200 with the core result body on success", async () => {
  const response = await handler(success)(url);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), success);
});

test("maps each error code to its status and returns the error body", async () => {
  const cases: Array<[BestPublishTimesResponse, number]> = [
    [error("AUTH_REQUIRED"), 401],
    [error("AUTH_SCOPE_INSUFFICIENT", ["yt-analytics.readonly"]), 403],
    [error("INVALID_INPUT"), 422],
    [error("ANALYTICS_API_ERROR"), 502],
    [error("UNEXPECTED"), 500],
  ];
  for (const [result, expected] of cases) {
    const response = await handler(result)(url);
    assert.equal(response.status, expected);
    assert.deepEqual(await response.json(), result);
  }
});

test("includes requiredScopes in the 403 body", async () => {
  const response = await handler(
    error("AUTH_SCOPE_INSUFFICIENT", ["yt-analytics.readonly"]),
  )(url);

  assert.equal(response.status, 403);
  assert.deepEqual((await response.json()).requiredScopes, [
    "yt-analytics.readonly",
  ]);
});

test("sanitizes unexpected core exceptions with a 500 response", async () => {
  const response = await createBestPublishTimesGetHandler({
    getSession: session,
    core: {
      fetchBestPublishTimes: async () => {
        throw new Error("sensitive provider details");
      },
    },
  })(url);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    kind: "best-publish-times-error",
    code: "ANALYTICS_API_ERROR",
    message: "Internal error",
  });
});
