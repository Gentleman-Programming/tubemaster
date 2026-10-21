import assert from "node:assert/strict";
import test from "node:test";
import type { youtube_v3 } from "googleapis";
import { YOUTUBE_READ_SCOPE } from "@/lib/auth";
import { InMemoryQuotaAccountant } from "@/lib/quota/accountant";
import { DomainError, type ResolvedCredentials } from "@/lib/video-metadata/contracts";
import { createYoutubeScheduleApi } from "../adapters/youtube-api";
import { createScheduledYoutubeVideosService } from "../services";
import type { YoutubeScheduleDependencies, YoutubeUploadStatus } from "../contracts";

const credentials: ResolvedCredentials = {
  credentialRef: { userId: "u1" },
  accessToken: "token",
  scopeSet: new Set([YOUTUBE_READ_SCOPE]),
};

function service(uploads: YoutubeUploadStatus[] | Error, overrides: Partial<YoutubeScheduleDependencies> = {}) {
  const calls: { requiredScopes: readonly string[]; maxVideos?: number }[] = [];
  const run = createScheduledYoutubeVideosService({
    authResolver: {
      async resolve(args) {
        calls.push({ requiredScopes: args.requiredScopes });
        return credentials;
      },
    },
    api: {
      async listRecentUploads(args) {
        calls.push({ requiredScopes: [], maxVideos: args.maxVideos });
        if (uploads instanceof Error) throw uploads;
        return uploads;
      },
    },
    ...overrides,
  });
  return { run, calls };
}

test("returns only private uploads with a publishAt, mapped and sorted by publish time", async () => {
  const { run, calls } = service([
    { videoId: "late", title: "Late", privacyStatus: "private", publishAt: "2026-11-02T10:00:00Z" },
    { videoId: "public", title: "Public", privacyStatus: "public", publishAt: "2026-11-01T10:00:00Z" },
    { videoId: "draft", title: "Draft", privacyStatus: "private" },
    { videoId: "unlisted", title: "Unlisted", privacyStatus: "unlisted", publishAt: "2026-11-01T10:00:00Z" },
    { videoId: "broken", title: "Broken", privacyStatus: "private", publishAt: "soon" },
    {
      videoId: "early",
      title: "Early",
      privacyStatus: "private",
      publishAt: "2026-10-30T18:00:00Z",
      thumbnailUrl: "https://i.ytimg.com/early.jpg",
    },
  ]);

  const result = await run({ credentialRef: { userId: "u1" } });

  assert.deepEqual(result, {
    kind: "youtube-scheduled-videos",
    videos: [
      { videoId: "early", title: "Early", publishAt: "2026-10-30T18:00:00Z", thumbnailUrl: "https://i.ytimg.com/early.jpg" },
      { videoId: "late", title: "Late", publishAt: "2026-11-02T10:00:00Z" },
    ],
  });
  assert.deepEqual(calls, [{ requiredScopes: [YOUTUBE_READ_SCOPE] }, { requiredScopes: [], maxVideos: 50 }]);
});

test("returns an empty list when nothing is scheduled", async () => {
  const { run } = service([]);
  assert.deepEqual(await run({ credentialRef: { userId: "u1" } }), { kind: "youtube-scheduled-videos", videos: [] });
});

test("maps credential failures to AUTH_REQUIRED and missing scopes to AUTH_SCOPE_INSUFFICIENT", async () => {
  const unauthorized = service([], {
    authResolver: {
      async resolve() {
        throw new Error("no tokens");
      },
    },
  });
  assert.deepEqual(await unauthorized.run({ credentialRef: { userId: "u1" } }), {
    kind: "youtube-scheduled-videos-error",
    code: "AUTH_REQUIRED",
    message: "Authentication required",
  });

  const scope = service([], {
    authResolver: {
      async resolve() {
        throw new DomainError({ code: "AUTH_SCOPE_INSUFFICIENT", message: "missing" });
      },
    },
  });
  assert.deepEqual(await scope.run({ credentialRef: { userId: "u1" } }), {
    kind: "youtube-scheduled-videos-error",
    code: "AUTH_SCOPE_INSUFFICIENT",
    message: "Reauthorization with the youtube.readonly scope is required.",
    requiredScopes: ["youtube.readonly"],
  });
});

test("maps provider failures to YOUTUBE_API_ERROR without leaking details", async () => {
  const { run } = service(new Error("quotaExceeded: secret details"));
  assert.deepEqual(await run({ credentialRef: { userId: "u1" } }), {
    kind: "youtube-scheduled-videos-error",
    code: "YOUTUBE_API_ERROR",
    message: "YouTube request failed",
  });
});

test("passes the quota context built from the factory to the api", async () => {
  const accountant = new InMemoryQuotaAccountant();
  let received: unknown;
  const run = createScheduledYoutubeVideosService({
    authResolver: { resolve: async () => credentials },
    api: {
      async listRecentUploads(args) {
        received = args.quota;
        return [];
      },
    },
    quotaAccountantFactory: () => accountant,
    operationIdFactory: () => "op-1",
  });

  await run({ credentialRef: { userId: "u1" } });
  assert.deepEqual(received, { operationId: "op-1", quotaAccountant: accountant });
});

test("adapter lists the uploads playlist, reads status and snippet in batches and records quota", async () => {
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const youtube = {
    channels: {
      async list(params: Record<string, unknown>) {
        requests.push({ method: "channels.list", params });
        return params.mine
          ? { data: { items: [{ id: "channel-1" }] } }
          : { data: { items: [{ contentDetails: { relatedPlaylists: { uploads: "uploads-1" } } }] } };
      },
    },
    playlistItems: {
      async list(params: Record<string, unknown>) {
        requests.push({ method: "playlistItems.list", params });
        return {
          data: {
            items: [
              { snippet: { resourceId: { videoId: "v1" }, title: "One" } },
              { snippet: { resourceId: { videoId: "v2" }, title: "Two" } },
            ],
          },
        };
      },
    },
    videos: {
      async list(params: Record<string, unknown>) {
        requests.push({ method: "videos.list", params });
        return {
          data: {
            items: [
              {
                id: "v1",
                snippet: { title: "One", thumbnails: { medium: { url: "https://i.ytimg.com/v1/mq.jpg" } } },
                status: { privacyStatus: "private", publishAt: "2026-11-01T10:00:00Z" },
              },
              { id: "v2", snippet: { title: "Two" }, status: { privacyStatus: "public" } },
            ],
          },
        };
      },
    },
  } as unknown as youtube_v3.Youtube;
  const accountant = new InMemoryQuotaAccountant();
  const api = createYoutubeScheduleApi({ youtubeFactory: () => youtube });

  const uploads = await api.listRecentUploads({
    credentials,
    maxVideos: 50,
    quota: { operationId: "op-1", quotaAccountant: accountant },
  });

  assert.deepEqual(uploads, [
    {
      videoId: "v1",
      title: "One",
      privacyStatus: "private",
      publishAt: "2026-11-01T10:00:00Z",
      thumbnailUrl: "https://i.ytimg.com/v1/mq.jpg",
    },
    { videoId: "v2", title: "Two", privacyStatus: "public" },
  ]);
  const videosCall = requests.find((request) => request.method === "videos.list");
  assert.deepEqual(videosCall?.params.part, ["status", "snippet"]);
  assert.deepEqual(videosCall?.params.id, ["v1", "v2"]);
  assert.ok(accountant.entries().some((entry) => entry.operation === "videos.list" && entry.operationId === "op-1"));
});

test("adapter returns no uploads when the channel cannot be resolved", async () => {
  const youtube = {
    channels: { list: async () => ({ data: { items: [] } }) },
  } as unknown as youtube_v3.Youtube;
  const api = createYoutubeScheduleApi({ youtubeFactory: () => youtube });

  assert.deepEqual(await api.listRecentUploads({ credentials, maxVideos: 50 }), []);
});
