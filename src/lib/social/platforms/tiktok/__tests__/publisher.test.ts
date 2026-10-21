import assert from "node:assert/strict";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SocialPublishError, type SocialAccount, type SocialAccountTokens, type SocialOAuthConnector } from "../../../contracts";
import { TIKTOK_ENDPOINTS } from "../endpoints";
import { computeTikTokChunks, createTikTokPublisher } from "../publisher";

const MiB = 1024 * 1024;
const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const UPLOAD_URL = "https://open-upload.tiktokapis.com/video/?upload_id=1&upload_token=t";

type Call = { url: string; method: string; headers: Headers; json?: unknown; bytes?: number };
type Reply = { status?: number; body?: unknown };

const ok = (data: unknown): Reply => ({ body: { data, error: { code: "ok", message: "", log_id: "l" } } });
const creatorInfo = (overrides: Record<string, unknown> = {}) => ok({
  creator_username: "gentleman", privacy_level_options: ["SELF_ONLY"],
  comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 600, ...overrides,
});

function fakeFetch(routes: Record<string, Reply[]>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const call: Call = { url, method: init.method ?? "GET", headers: new Headers(init.headers) };
    if (typeof init.body === "string") call.json = JSON.parse(init.body);
    else if (init.body) call.bytes = (await new Response(init.body).arrayBuffer()).byteLength;
    calls.push(call);
    const key = url.startsWith("https://open-upload") ? "upload" : url;
    const reply = routes[key]?.shift();
    if (!reply) throw new Error(`Unexpected request to ${url}`);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const account: SocialAccount = {
  id: "acc-1", userId: "user-1", platform: "tiktok", externalAccountId: "open-1", displayName: "Gentleman",
  scopes: ["user.info.basic", "video.publish"], tokenExpiresAt: "2026-10-22T12:00:00.000Z", connectedAt: "2026-10-21T00:00:00.000Z",
};
const freshTokens: SocialAccountTokens = { accessToken: "act.1", refreshToken: "rft.1", expiresAt: "2026-10-22T12:00:00.000Z" };

function connectorStub(refreshed?: SocialAccountTokens) {
  const refreshCalls: SocialAccountTokens[] = [];
  const connector: SocialOAuthConnector = {
    platform: "tiktok",
    authorizationUrl: () => "",
    exchangeCode: async () => { throw new Error("unused"); },
    refreshTokens: async (tokens) => {
      refreshCalls.push(tokens);
      if (!refreshed) throw new Error("refresh failed");
      return refreshed;
    },
  };
  return { connector, refreshCalls };
}

function withVideo(size: number, run: (path: string) => Promise<void>, name = "clip.mp4") {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "tiktok-publisher-"));
    const path = join(dir, name);
    writeFileSync(path, "");
    truncateSync(path, size);
    try { await run(path); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
}

function setup(routes: Record<string, Reply[]>, options: { refreshed?: SocialAccountTokens; pollTimeoutMs?: number } = {}) {
  const { fetch, calls } = fakeFetch(routes);
  const { connector, refreshCalls } = connectorStub(options.refreshed);
  let clock = NOW;
  const sleeps: number[] = [];
  const publisher = createTikTokPublisher({
    connector, fetch, now: () => clock, pollIntervalMs: 1000, pollTimeoutMs: options.pollTimeoutMs ?? 5000,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
  });
  return { publisher, calls, refreshCalls, sleeps };
}

const request = (videoPath: string, overrides: Partial<{ tokens: SocialAccountTokens; platformOptions: Record<string, string | boolean> }> = {}) => ({
  account, tokens: freshTokens, videoPath, caption: "My caption #dev", platformOptions: { privacyLevel: "SELF_ONLY" }, ...overrides,
});

async function rejectsWith(promise: Promise<unknown>, code: string, message?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SocialPublishError, `expected SocialPublishError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    assert.doesNotMatch(error.message, /act\.|rft\./);
    return true;
  });
}

test("chunk math follows TikTok rules", () => {
  assert.deepEqual(computeTikTokChunks(1 * MiB), {
    videoSize: MiB, chunkSize: MiB, totalChunkCount: 1, chunks: [{ start: 0, end: MiB - 1 }],
  });
  assert.deepEqual(computeTikTokChunks(5 * MiB), {
    videoSize: 5 * MiB, chunkSize: 5 * MiB, totalChunkCount: 1, chunks: [{ start: 0, end: 5 * MiB - 1 }],
  });
  assert.deepEqual(computeTikTokChunks(25 * MiB), {
    videoSize: 25 * MiB, chunkSize: 10 * MiB, totalChunkCount: 2,
    chunks: [{ start: 0, end: 10 * MiB - 1 }, { start: 10 * MiB, end: 25 * MiB - 1 }],
  });
  const size = 23.5 * MiB;
  assert.deepEqual(computeTikTokChunks(size), {
    videoSize: size, chunkSize: 10 * MiB, totalChunkCount: 2,
    chunks: [{ start: 0, end: 10 * MiB - 1 }, { start: 10 * MiB, end: size - 1 }],
  });
  assert.equal(computeTikTokChunks(30 * MiB).totalChunkCount, 3);
  assert.throws(() => computeTikTokChunks(0), /empty/i);
});

test("happy path: creator info, init, chunked upload with Content-Range, then poll until complete", withVideo(21 * MiB, async (path) => {
  const { publisher, calls, refreshCalls, sleeps } = setup({
    [TIKTOK_ENDPOINTS.creatorInfo]: [creatorInfo()],
    [TIKTOK_ENDPOINTS.videoInit]: [ok({ publish_id: "pub-1", upload_url: UPLOAD_URL })],
    upload: [{ status: 206 }, { status: 201 }],
    [TIKTOK_ENDPOINTS.status]: [ok({ status: "PROCESSING_UPLOAD" }), ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] })],
  });
  const result = await publisher.publish(request(path, { platformOptions: { privacyLevel: "SELF_ONLY", disableComment: true } }));

  assert.deepEqual(result, { externalPostId: "pub-1" });
  assert.equal(refreshCalls.length, 0);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url.startsWith("https://open-upload") ? "upload" : call.url}`), [
    `POST ${TIKTOK_ENDPOINTS.creatorInfo}`, `POST ${TIKTOK_ENDPOINTS.videoInit}`, "PUT upload", "PUT upload",
    `POST ${TIKTOK_ENDPOINTS.status}`, `POST ${TIKTOK_ENDPOINTS.status}`,
  ]);
  assert.equal(calls[0].headers.get("authorization"), "Bearer act.1");
  assert.deepEqual(calls[1].json, {
    post_info: { title: "My caption #dev", privacy_level: "SELF_ONLY", disable_comment: true, disable_duet: true, disable_stitch: false },
    source_info: { source: "FILE_UPLOAD", video_size: 21 * MiB, chunk_size: 10 * MiB, total_chunk_count: 2 },
  });
  assert.equal(calls[2].headers.get("content-range"), `bytes 0-${10 * MiB - 1}/${21 * MiB}`);
  assert.equal(calls[2].headers.get("content-length"), String(10 * MiB));
  assert.equal(calls[2].headers.get("content-type"), "video/mp4");
  assert.equal(calls[2].headers.get("authorization"), null);
  assert.equal(calls[2].bytes, 10 * MiB);
  assert.equal(calls[3].headers.get("content-range"), `bytes ${10 * MiB}-${21 * MiB - 1}/${21 * MiB}`);
  assert.equal(calls[3].bytes, 11 * MiB);
  assert.deepEqual(calls[4].json, { publish_id: "pub-1" });
  assert.deepEqual(sleeps, [1000, 1000]);
}));

test("uses the public post id when TikTok returns one and the content type from the extension", withVideo(MiB, async (path) => {
  const { publisher, calls } = setup({
    [TIKTOK_ENDPOINTS.creatorInfo]: [creatorInfo({ privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] })],
    [TIKTOK_ENDPOINTS.videoInit]: [ok({ publish_id: "pub-2", upload_url: UPLOAD_URL })],
    upload: [{ status: 201 }],
    [TIKTOK_ENDPOINTS.status]: [ok({ status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7123456789] })],
  });
  const result = await publisher.publish(request(path, { platformOptions: { privacyLevel: "PUBLIC_TO_EVERYONE" } }));
  assert.deepEqual(result, { externalPostId: "7123456789" });
  assert.equal(calls[2].headers.get("content-type"), "video/quicktime");
  assert.equal(calls[2].headers.get("content-range"), `bytes 0-${MiB - 1}/${MiB}`);
}, "clip.mov"));

test("a privacy level the creator does not allow is REJECTED before any upload", withVideo(MiB, async (path) => {
  const { publisher, calls } = setup({ [TIKTOK_ENDPOINTS.creatorInfo]: [creatorInfo(), creatorInfo()] });
  await rejectsWith(publisher.publish(request(path, { platformOptions: { privacyLevel: "PUBLIC_TO_EVERYONE" } })), "REJECTED", /PUBLIC_TO_EVERYONE.*SELF_ONLY/);
  await rejectsWith(publisher.publish(request(path, { platformOptions: {} })), "REJECTED", /privacyLevel/);
  assert.deepEqual(calls.map((call) => call.url), [TIKTOK_ENDPOINTS.creatorInfo, TIKTOK_ENDPOINTS.creatorInfo]);
}));

test("tokens expiring within 5 minutes are refreshed first and returned", withVideo(MiB, async (path) => {
  const refreshed = { accessToken: "act.2", refreshToken: "rft.2", expiresAt: "2026-10-22T12:00:00.000Z" };
  const { publisher, calls, refreshCalls } = setup({
    [TIKTOK_ENDPOINTS.creatorInfo]: [creatorInfo()],
    [TIKTOK_ENDPOINTS.videoInit]: [ok({ publish_id: "pub-3", upload_url: UPLOAD_URL })],
    upload: [{ status: 201 }],
    [TIKTOK_ENDPOINTS.status]: [ok({ status: "PUBLISH_COMPLETE" })],
  }, { refreshed });
  const nearExpiry = { ...freshTokens, expiresAt: "2026-10-21T12:04:00.000Z" };
  const result = await publisher.publish(request(path, { tokens: nearExpiry }));
  assert.deepEqual(refreshCalls, [nearExpiry]);
  assert.deepEqual(result, { externalPostId: "pub-3", refreshedTokens: refreshed });
  assert.equal(calls[0].headers.get("authorization"), "Bearer act.2");
}));

test("a failed refresh is AUTH_EXPIRED", withVideo(MiB, async (path) => {
  const { publisher, calls } = setup({});
  await rejectsWith(publisher.publish(request(path, { tokens: { ...freshTokens, expiresAt: "2026-10-21T11:00:00.000Z" } })), "AUTH_EXPIRED");
  assert.equal(calls.length, 0);
}));

test("HTTP 401, 429 and 500 map to AUTH_EXPIRED, RATE_LIMITED and PROVIDER_ERROR", withVideo(MiB, async (path) => {
  for (const [status, code] of [[401, "AUTH_EXPIRED"], [429, "RATE_LIMITED"], [500, "PROVIDER_ERROR"]] as const) {
    const { publisher } = setup({ [TIKTOK_ENDPOINTS.creatorInfo]: [{ status, body: { error: { code: "x", message: "act.1" } } }] });
    await rejectsWith(publisher.publish(request(path)), code);
  }
  const upload500 = setup({
    [TIKTOK_ENDPOINTS.creatorInfo]: [creatorInfo()],
    [TIKTOK_ENDPOINTS.videoInit]: [ok({ publish_id: "pub-4", upload_url: UPLOAD_URL })],
    upload: [{ status: 500 }],
  });
  await rejectsWith(upload500.publisher.publish(request(path)), "PROVIDER_ERROR", /upload/i);
}));

test("TikTok error codes in the body are mapped", withVideo(MiB, async (path) => {
  const cases = [
    ["access_token_invalid", "AUTH_EXPIRED"], ["rate_limit_exceeded", "RATE_LIMITED"],
    ["spam_risk_too_many_posts", "RATE_LIMITED"], ["privacy_level_option_mismatch", "REJECTED"], ["internal_error", "PROVIDER_ERROR"],
  ] as const;
  for (const [tiktokCode, code] of cases) {
    const { publisher } = setup({
      [TIKTOK_ENDPOINTS.creatorInfo]: [creatorInfo()],
      [TIKTOK_ENDPOINTS.videoInit]: [{ status: 400, body: { data: {}, error: { code: tiktokCode, message: "details", log_id: "l" } } }],
    });
    await rejectsWith(publisher.publish(request(path)), code, new RegExp(tiktokCode));
  }
}));

test("FAILED status is REJECTED with the fail reason", withVideo(MiB, async (path) => {
  const { publisher } = setup({
    [TIKTOK_ENDPOINTS.creatorInfo]: [creatorInfo()],
    [TIKTOK_ENDPOINTS.videoInit]: [ok({ publish_id: "pub-5", upload_url: UPLOAD_URL })],
    upload: [{ status: 201 }],
    [TIKTOK_ENDPOINTS.status]: [ok({ status: "FAILED", fail_reason: "duration_check" })],
  });
  await rejectsWith(publisher.publish(request(path)), "REJECTED", /duration_check/);
}));

test("polling past the timeout is PROVIDER_ERROR", withVideo(MiB, async (path) => {
  const processing = () => ok({ status: "PROCESSING_UPLOAD" });
  const { publisher, sleeps } = setup({
    [TIKTOK_ENDPOINTS.creatorInfo]: [creatorInfo()],
    [TIKTOK_ENDPOINTS.videoInit]: [ok({ publish_id: "pub-6", upload_url: UPLOAD_URL })],
    upload: [{ status: 201 }],
    [TIKTOK_ENDPOINTS.status]: Array.from({ length: 10 }, processing),
  }, { pollTimeoutMs: 3000 });
  await rejectsWith(publisher.publish(request(path)), "PROVIDER_ERROR", /pub-6|timed out/i);
  assert.equal(sleeps.length, 3);
}));
