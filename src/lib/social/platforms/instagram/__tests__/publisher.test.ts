import assert from "node:assert/strict";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SocialPublishError, type SocialAccount, type SocialAccountTokens, type SocialOAuthConnector } from "../../../contracts";
import { INSTAGRAM_ENDPOINTS } from "../endpoints";
import { createInstagramPublisher } from "../publisher";

const MiB = 1024 * 1024;
const NOW = Date.parse("2026-10-21T12:00:00.000Z");
const IG_USER = "ig-1";
const CONTAINER = "container-1";

type Call = { url: string; method: string; headers: Headers; form?: Record<string, string>; bytes?: number };
type Reply = { status?: number; body?: unknown };

const MEDIA = INSTAGRAM_ENDPOINTS.media(IG_USER);
const PUBLISH = INSTAGRAM_ENDPOINTS.mediaPublish(IG_USER);
const STATUS = INSTAGRAM_ENDPOINTS.containerStatus(CONTAINER);
const UPLOAD = INSTAGRAM_ENDPOINTS.upload(CONTAINER);

function fakeFetch(routes: Record<string, Reply[]>) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const call: Call = { url, method: init.method ?? "GET", headers: new Headers(init.headers) };
    if (typeof init.body === "string") call.form = Object.fromEntries(new URLSearchParams(init.body));
    else if (init.body) call.bytes = (await new Response(init.body).arrayBuffer()).byteLength;
    calls.push(call);
    const reply = routes[url]?.shift();
    if (!reply) throw new Error(`Unexpected request to ${url}`);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const account: SocialAccount = {
  id: "acc-1", userId: "user-1", platform: "instagram", externalAccountId: IG_USER, displayName: "gentleman.programming",
  scopes: ["instagram_basic", "instagram_content_publish"], tokenExpiresAt: "2026-12-20T12:00:00.000Z", connectedAt: "2026-10-21T00:00:00.000Z",
};
const freshTokens: SocialAccountTokens = { accessToken: "EAA.1", expiresAt: "2026-12-20T12:00:00.000Z" };

function connectorStub(refreshed?: SocialAccountTokens) {
  const refreshCalls: SocialAccountTokens[] = [];
  const connector: SocialOAuthConnector = {
    platform: "instagram",
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

function withVideo(size: number, run: (path: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "instagram-publisher-"));
    const path = join(dir, "clip.mp4");
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
  const publisher = createInstagramPublisher({
    connector, fetch, now: () => clock, pollIntervalMs: 1000, pollTimeoutMs: options.pollTimeoutMs ?? 5000,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
  });
  return { publisher, calls, refreshCalls, sleeps };
}

const request = (videoPath: string, overrides: Partial<{ tokens: SocialAccountTokens; platformOptions: Record<string, boolean> }> = {}) => ({
  account, tokens: freshTokens, videoPath, caption: "My reel #dev", platformOptions: {}, ...overrides,
});

const happyRoutes = (): Record<string, Reply[]> => ({
  [MEDIA]: [{ body: { id: CONTAINER, uri: UPLOAD } }],
  [UPLOAD]: [{ body: { success: true, message: "Upload successful." } }],
  [STATUS]: [{ body: { status_code: "IN_PROGRESS", status: "In Progress", id: CONTAINER } }, { body: { status_code: "FINISHED", status: "Finished", id: CONTAINER } }],
  [PUBLISH]: [{ body: { id: "media-1" } }],
});

async function rejectsWith(promise: Promise<unknown>, code: string, message?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof SocialPublishError, `expected SocialPublishError, got ${String(error)}`);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    assert.doesNotMatch(error.message, /EAA\.|app-secret/);
    return true;
  });
}

test("happy path: resumable container, rupload, status polling, then media_publish", withVideo(3 * MiB, async (path) => {
  const { publisher, calls, refreshCalls, sleeps } = setup(happyRoutes());
  const result = await publisher.publish(request(path));

  assert.deepEqual(result, { externalPostId: "media-1" });
  assert.equal(refreshCalls.length, 0);
  assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
    `POST ${MEDIA}`, `POST ${UPLOAD}`, `GET ${STATUS}`, `GET ${STATUS}`, `POST ${PUBLISH}`,
  ]);
  assert.equal(calls[0].headers.get("authorization"), "Bearer EAA.1");
  assert.deepEqual(calls[0].form, { media_type: "REELS", upload_type: "resumable", caption: "My reel #dev", share_to_feed: "true" });

  assert.equal(UPLOAD, `https://rupload.facebook.com/ig-api-upload/${INSTAGRAM_ENDPOINTS.version}/${CONTAINER}`);
  assert.equal(calls[1].headers.get("authorization"), "OAuth EAA.1");
  assert.equal(calls[1].headers.get("offset"), "0");
  assert.equal(calls[1].headers.get("file_size"), String(3 * MiB));
  assert.equal(calls[1].bytes, 3 * MiB);

  assert.equal(calls[2].headers.get("authorization"), "Bearer EAA.1");
  assert.deepEqual(calls[4].form, { creation_id: CONTAINER });
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.equal(calls.some((call) => call.url.includes("EAA.")), false);
}));

test("share_to_feed follows platformOptions.shareToFeed", withVideo(MiB, async (path) => {
  const { publisher, calls } = setup(happyRoutes());
  await publisher.publish(request(path, { platformOptions: { shareToFeed: false } }));
  assert.equal(calls[0].form?.share_to_feed, "false");
}));

test("ERROR and EXPIRED container statuses are REJECTED with the status", withVideo(MiB, async (path) => {
  for (const statusCode of ["ERROR", "EXPIRED"]) {
    const { publisher, calls } = setup({
      ...happyRoutes(),
      [STATUS]: [{ body: { status_code: statusCode, status: "Error: Media upload has failed with error code 2207026" } }],
    });
    await rejectsWith(publisher.publish(request(path)), "REJECTED", new RegExp(`${statusCode}.*2207026`));
    assert.equal(calls.some((call) => call.url === PUBLISH), false);
  }
}));

test("polling past the timeout is PROVIDER_ERROR", withVideo(MiB, async (path) => {
  const { publisher, sleeps } = setup({
    ...happyRoutes(),
    [STATUS]: Array.from({ length: 10 }, () => ({ body: { status_code: "IN_PROGRESS" } })),
  }, { pollTimeoutMs: 3000 });
  await rejectsWith(publisher.publish(request(path)), "PROVIDER_ERROR", /timed out/i);
  assert.equal(sleeps.length, 3);
}));

test("HTTP 401 and OAuthException 190 are AUTH_EXPIRED", withVideo(MiB, async (path) => {
  const unauthorized = setup({ [MEDIA]: [{ status: 401, body: { error: { message: "EAA.1 bad", code: 102 } } }] });
  await rejectsWith(unauthorized.publisher.publish(request(path)), "AUTH_EXPIRED");
  const expired = setup({ [MEDIA]: [{ status: 400, body: { error: { message: "Session expired EAA.1", type: "OAuthException", code: 190 } } }] });
  await rejectsWith(expired.publisher.publish(request(path)), "AUTH_EXPIRED", /190/);
  const uploadUnauthorized = setup({ ...happyRoutes(), [UPLOAD]: [{ status: 401, body: { debug_info: { message: "EAA.1" } } }] });
  await rejectsWith(uploadUnauthorized.publisher.publish(request(path)), "AUTH_EXPIRED", /upload/i);
}));

test("HTTP 429 and Graph rate-limit codes are RATE_LIMITED", withVideo(MiB, async (path) => {
  const tooMany = setup({ [MEDIA]: [{ status: 429, body: {} }] });
  await rejectsWith(tooMany.publisher.publish(request(path)), "RATE_LIMITED");
  for (const code of [4, 17, 32, 613]) {
    const limited = setup({ ...happyRoutes(), [PUBLISH]: [{ status: 400, body: { error: { message: "limit", type: "OAuthException", code } } }] });
    await rejectsWith(limited.publisher.publish(request(path)), "RATE_LIMITED", new RegExp(`code ${code}`));
  }
}));

test("other failures are PROVIDER_ERROR", withVideo(MiB, async (path) => {
  const serverError = setup({ [MEDIA]: [{ status: 500, body: { error: { message: "EAA.1", code: 2 } } }] });
  await rejectsWith(serverError.publisher.publish(request(path)), "PROVIDER_ERROR", /HTTP 500/);
  const uploadFailure = setup({ ...happyRoutes(), [UPLOAD]: [{ status: 500, body: {} }] });
  await rejectsWith(uploadFailure.publisher.publish(request(path)), "PROVIDER_ERROR", /upload/i);
  const noContainer = setup({ [MEDIA]: [{ body: {} }] });
  await rejectsWith(noContainer.publisher.publish(request(path)), "PROVIDER_ERROR", /container/i);
}));

test("an empty or missing video is REJECTED before any request", withVideo(0, async (path) => {
  const { publisher, calls } = setup({});
  await rejectsWith(publisher.publish(request(path)), "REJECTED", /missing or empty/);
  await rejectsWith(publisher.publish(request(`${path}.missing`)), "REJECTED", /missing or empty/);
  assert.equal(calls.length, 0);
}));

test("tokens expiring within 7 days are refreshed first and returned", withVideo(MiB, async (path) => {
  const refreshed = { accessToken: "EAA.2", expiresAt: "2026-12-25T12:00:00.000Z" };
  const { publisher, calls, refreshCalls } = setup(happyRoutes(), { refreshed });
  const nearExpiry = { accessToken: "EAA.1", expiresAt: "2026-10-27T12:00:00.000Z" };
  const result = await publisher.publish(request(path, { tokens: nearExpiry }));
  assert.deepEqual(refreshCalls, [nearExpiry]);
  assert.deepEqual(result, { externalPostId: "media-1", refreshedTokens: refreshed });
  assert.equal(calls[0].headers.get("authorization"), "Bearer EAA.2");
  assert.equal(calls[1].headers.get("authorization"), "OAuth EAA.2");
}));

test("a failed refresh is AUTH_EXPIRED", withVideo(MiB, async (path) => {
  const { publisher, calls } = setup({});
  await rejectsWith(publisher.publish(request(path, { tokens: { accessToken: "EAA.1", expiresAt: "2026-10-21T11:00:00.000Z" } })), "AUTH_EXPIRED");
  assert.equal(calls.length, 0);
}));
