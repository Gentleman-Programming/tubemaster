import assert from "node:assert/strict";
import test from "node:test";
import type { youtube_v3 } from "googleapis";
import { createBestPublishTimesApi } from "../../adapters/youtube-api";
import { DomainError } from "../../../video-metadata/contracts";
import type { QuotaAccountant } from "../../../quota/accountant";

const credentials = {
  credentialRef: { userId: "u1" },
  accessToken: "at",
  scopeSet: new Set<string>(),
};

function fakeYoutube(calls: string[], videosListIds: string[][]) {
  return {
    channels: {
      list: async (params: { mine?: boolean; id?: string[] }) => {
        calls.push("channels.list");
        return params.mine
          ? { data: { items: [{ id: "UC1" }] } }
          : { data: { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] } };
      },
    },
    playlistItems: {
      list: async () => {
        calls.push("playlistItems.list");
        return {
          data: {
            items: [
              { snippet: { resourceId: { videoId: "v1" }, publishedAt: "2026-01-01T00:00:00Z" } },
              { snippet: { resourceId: { videoId: "v2" }, publishedAt: "2026-01-02T00:00:00Z" } },
              { snippet: { resourceId: { videoId: "gone" }, publishedAt: "2026-01-03T00:00:00Z" } },
            ],
          },
        };
      },
    },
    videos: {
      list: async (params: { id: string[] }) => {
        calls.push("videos.list");
        videosListIds.push(params.id);
        return {
          data: {
            items: [
              { id: "v1", snippet: { publishedAt: "2026-02-10T18:30:00Z" } },
              { id: "v2", snippet: { publishedAt: "2026-02-12T09:00:00Z" } },
            ],
          },
        };
      },
    },
  } as unknown as youtube_v3.Youtube;
}

test("lists recent videos with the real publish time from videos.list and records quota", async () => {
  const calls: string[] = [];
  const videosListIds: string[][] = [];
  const recorded: string[] = [];
  const quotaAccountant: QuotaAccountant = { record: (entry) => recorded.push(entry.operation) };
  const api = createBestPublishTimesApi({ youtubeFactory: () => fakeYoutube(calls, videosListIds) });

  const videos = await api.listRecentVideos({
    credentials,
    maxVideos: 50,
    quota: { operationId: "op-1", quotaAccountant },
  });

  assert.deepEqual(videos, [
    { videoId: "v2", publishedAt: "2026-02-12T09:00:00Z" },
    { videoId: "v1", publishedAt: "2026-02-10T18:30:00Z" },
  ]);
  assert.deepEqual(videosListIds, [["v1", "v2", "gone"]]);
  assert.deepEqual(recorded, ["channels.list", "channels.list", "playlistItems.list", "videos.list"]);
});

test("returns no videos when the channel cannot be resolved", async () => {
  const youtube = {
    channels: { list: async () => ({ data: { items: [] } }) },
  } as unknown as youtube_v3.Youtube;
  const api = createBestPublishTimesApi({ youtubeFactory: () => youtube });
  assert.deepEqual(await api.listRecentVideos({ credentials, maxVideos: 50 }), []);
});

type AnalyticsMock = {
  args?: Record<string, unknown>;
  response?: unknown;
  fail?: boolean;
};
const analytics = (mock: AnalyticsMock) => () => ({
  reports: {
    query: async (args: Record<string, unknown>) => {
      mock.args = args;
      if (mock.fail) throw new Error("network");
      return mock.response ?? {};
    },
  },
});
const earlyQuery = { credentials, videoId: "v1", startDate: "2026-02-10", endDate: "2026-02-12" };

test("queries early views for one video with exact reports.query parameters", async () => {
  const mock: AnalyticsMock = {
    response: { data: { columnHeaders: [{ name: "views" }], rows: [["1234"]] } },
  };
  const views = await createBestPublishTimesApi({ analyticsFactory: analytics(mock) }).queryEarlyViews(earlyQuery);
  assert.equal(views, 1234);
  assert.deepEqual(mock.args, {
    ids: "channel==MINE",
    startDate: "2026-02-10",
    endDate: "2026-02-12",
    metrics: "views",
    filters: "video==v1",
  });
});

test("treats an empty early-views report as zero views", async () => {
  const mock: AnalyticsMock = { response: { columnHeaders: [{ name: "views" }], rows: [] } };
  assert.equal(await createBestPublishTimesApi({ analyticsFactory: analytics(mock) }).queryEarlyViews(earlyQuery), 0);
});

test("rejects malformed early-views reports and provider failures with a DomainError", async () => {
  const malformed: AnalyticsMock = { response: { columnHeaders: [{ name: "likes" }], rows: [["3"]] } };
  await assert.rejects(
    createBestPublishTimesApi({ analyticsFactory: analytics(malformed) }).queryEarlyViews(earlyQuery),
    (err) => err instanceof DomainError && err.message === "Malformed analytics response",
  );
  const failing: AnalyticsMock = { fail: true };
  await assert.rejects(
    createBestPublishTimesApi({ analyticsFactory: analytics(failing) }).queryEarlyViews(earlyQuery),
    (err) => err instanceof DomainError && err.message === "YouTube Analytics request failed",
  );
});
