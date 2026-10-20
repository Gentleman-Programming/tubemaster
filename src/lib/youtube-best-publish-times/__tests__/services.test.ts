import assert from "node:assert/strict";
import test from "node:test";
import { createBestPublishTimesService } from "../services";
import { DomainError } from "../../video-metadata/contracts";
import type { BestPublishTimesApi, BestPublishTimesDependencies } from "../contracts";

const TZ = "America/Argentina/Buenos_Aires";
const credentials = { credentialRef: { userId: "u1" }, accessToken: "at", scopeSet: new Set<string>() };
const now = () => new Date("2026-03-01T00:00:00Z");

const history: Record<string, { publishedAt: string; earlyViews: number }> = {
  a: { publishedAt: "2026-02-02T21:00:00Z", earlyViews: 100 }, // monday 18-21
  b: { publishedAt: "2026-02-09T22:00:00Z", earlyViews: 300 }, // monday 18-21
  c: { publishedAt: "2026-02-03T12:00:00Z", earlyViews: 50 }, // tuesday 9-12
  d: { publishedAt: "2026-02-10T13:00:00Z", earlyViews: 70 }, // tuesday 9-12
  e: { publishedAt: "2026-02-04T15:00:00Z", earlyViews: 1000 }, // wednesday 12-15, single sample
  f: { publishedAt: "2026-02-05T23:00:00Z", earlyViews: 200 }, // thursday 18-21
  g: { publishedAt: "2026-02-12T23:30:00Z", earlyViews: 400 }, // thursday 18-21
  h: { publishedAt: "2026-02-06T15:00:00Z", earlyViews: 80 }, // friday 12-15
  i: { publishedAt: "2026-02-13T16:00:00Z", earlyViews: 90 }, // friday 12-15
  j: { publishedAt: "2026-02-07T03:00:00Z", earlyViews: 10 }, // saturday 0-3
  young: { publishedAt: "2026-02-27T12:00:00Z", earlyViews: 5000 }, // early window incomplete
};

function setup(overrides: Partial<BestPublishTimesDependencies> = {}, ids = Object.keys(history)) {
  const calls = {
    resolve: 0,
    list: [] as { maxVideos: number; operationId?: string }[],
    early: [] as { videoId: string; startDate: string; endDate: string }[],
    quota: [] as string[],
  };
  const api: BestPublishTimesApi = {
    async listRecentVideos({ maxVideos, quota }) {
      calls.list.push({ maxVideos, operationId: quota?.operationId });
      return ids.map((videoId) => ({ videoId, publishedAt: history[videoId].publishedAt }));
    },
    async queryEarlyViews({ videoId, startDate, endDate }) {
      calls.early.push({ videoId, startDate, endDate });
      return history[videoId].earlyViews;
    },
  };
  const deps: BestPublishTimesDependencies = {
    authResolver: {
      async resolve(args) {
        calls.resolve += 1;
        assert.deepEqual(args.requiredScopes, ["https://www.googleapis.com/auth/yt-analytics.readonly"]);
        return credentials;
      },
    },
    api,
    quotaAccountant: { record: (entry) => calls.quota.push(entry.operation) },
    operationIdFactory: () => "op-1",
    now,
    ...overrides,
  };
  return { service: createBestPublishTimesService(deps), calls };
}

test("ranks the channel's publish slots by median early views relative to the channel median", async () => {
  const { service, calls } = setup();
  const result = await service({ credentialRef: { userId: "u1" }, timezone: TZ });

  assert.deepEqual(result, {
    kind: "best-publish-times",
    timezone: TZ,
    analyzedVideos: 10,
    excludedVideos: 1,
    channelMedianEarlyViews: 95,
    confidence: "normal",
    slots: [
      { weekday: "thursday", startHour: 18, endHour: 21, score: 3.16, sampleSize: 2, medianEarlyViews: 300 },
      { weekday: "monday", startHour: 18, endHour: 21, score: 2.11, sampleSize: 2, medianEarlyViews: 200 },
      { weekday: "friday", startHour: 12, endHour: 15, score: 0.89, sampleSize: 2, medianEarlyViews: 85 },
    ],
    method: { maxVideos: 50, minVideoAgeDays: 4, earlyWindowDays: 3, slotHours: 3, minSlotSamples: 2 },
  });
  assert.deepEqual(calls.list, [{ maxVideos: 50, operationId: "op-1" }]);
  assert.equal(calls.early.length, 10);
  assert.ok(!calls.early.some((call) => call.videoId === "young"));
  assert.deepEqual(
    calls.early.find((call) => call.videoId === "j"),
    { videoId: "j", startDate: "2026-02-06", endDate: "2026-02-08" },
  );
  assert.deepEqual(calls.quota, Array(10).fill("reports.query"));
});

test("reports low confidence when fewer than 10 videos were analyzed", async () => {
  const { service } = setup({}, ["a", "b", "c", "d"]);
  const result = await service({ credentialRef: { userId: "u1" }, timezone: TZ });
  assert.equal(result.kind, "best-publish-times");
  if (result.kind !== "best-publish-times") return;
  assert.equal(result.confidence, "low");
  assert.equal(result.analyzedVideos, 4);
  assert.deepEqual(result.slots.map((slot) => slot.weekday), ["monday", "tuesday"]);
});

test("reports low confidence and no slots when no slot has 2 or more videos", async () => {
  const { service } = setup({}, ["a", "c", "e", "f", "h", "j"]);
  const result = await service({ credentialRef: { userId: "u1" }, timezone: TZ });
  assert.equal(result.kind, "best-publish-times");
  if (result.kind !== "best-publish-times") return;
  assert.equal(result.confidence, "low");
  assert.deepEqual(result.slots, []);
});

test("rejects an invalid timezone before resolving credentials", async () => {
  for (const timezone of ["Mars/Olympus", ""]) {
    const { service, calls } = setup();
    assert.deepEqual(await service({ credentialRef: { userId: "u1" }, timezone }), {
      kind: "best-publish-times-error",
      code: "INVALID_INPUT",
      message: "timezone must be a valid IANA timezone",
    });
    assert.equal(calls.resolve, 0);
    assert.equal(calls.list.length, 0);
  }
});

test("maps an insufficient analytics scope and other auth failures to typed errors", async () => {
  const scoped = setup({
    authResolver: {
      resolve: async () => {
        throw new DomainError({ code: "AUTH_SCOPE_INSUFFICIENT", message: "missing" });
      },
    },
  });
  assert.deepEqual(await scoped.service({ credentialRef: { userId: "u1" }, timezone: TZ }), {
    kind: "best-publish-times-error",
    code: "AUTH_SCOPE_INSUFFICIENT",
    message: "Reauthorization with the yt-analytics.readonly scope is required.",
    requiredScopes: ["yt-analytics.readonly"],
  });
  assert.equal(scoped.calls.list.length, 0);

  const missing = setup({
    authResolver: {
      resolve: async () => {
        throw new Error("no user");
      },
    },
  });
  assert.deepEqual(await missing.service({ credentialRef: { userId: "u1" }, timezone: TZ }), {
    kind: "best-publish-times-error",
    code: "AUTH_REQUIRED",
    message: "Authentication required",
  });
});

test("maps YouTube API failures to ANALYTICS_API_ERROR", async () => {
  const { service } = setup({
    api: {
      listRecentVideos: async () => [{ videoId: "a", publishedAt: history.a.publishedAt }],
      queryEarlyViews: async () => {
        throw new DomainError({ code: "unauthorized", message: "YouTube Analytics request failed" });
      },
    },
  });
  assert.deepEqual(await service({ credentialRef: { userId: "u1" }, timezone: TZ }), {
    kind: "best-publish-times-error",
    code: "ANALYTICS_API_ERROR",
    message: "YouTube Analytics request failed",
  });
});
