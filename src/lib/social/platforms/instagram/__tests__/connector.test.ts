import assert from "node:assert/strict";
import test from "node:test";
import { createInstagramConnector, InstagramNoBusinessAccountError } from "../connector";
import { INSTAGRAM_ENDPOINTS, INSTAGRAM_GRAPH_VERSION, INSTAGRAM_SCOPES } from "../endpoints";
import { createInstagramConnectorFromEnv } from "../index";

type Recorded = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status?: number; body: unknown }>) {
  const calls: Recorded[] = [];
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request to ${String(input)}`);
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const NOW = new Date("2026-10-21T12:00:00.000Z");
const shortLived = { access_token: "EAA.short-secret", token_type: "bearer", expires_in: 3600 };
const longLived = { access_token: "EAA.long-secret", token_type: "bearer", expires_in: 5184000 };
const pages = {
  data: [
    { id: "page-1", name: "No IG page" },
    { id: "page-2", name: "Gentleman Page", instagram_business_account: { id: "ig-1", username: "gentleman.programming" } },
    { id: "page-3", name: "Other", instagram_business_account: { id: "ig-2", username: "other" } },
  ],
};

const searchParams = (url: string) => Object.fromEntries(new URL(url).searchParams);

test("authorizationUrl uses Facebook Login for Business with the publishing scopes and no PKCE", () => {
  const connector = createInstagramConnector({ appId: "app-1", appSecret: "app-secret", fetch: fakeFetch([]).fetch });
  const url = new URL(connector.authorizationUrl({ state: "st", codeChallenge: "chal", redirectUri: "https://t.example/api/social/instagram/callback" }));
  assert.equal(`${url.origin}${url.pathname}`, INSTAGRAM_ENDPOINTS.authorize);
  assert.equal(INSTAGRAM_ENDPOINTS.authorize, `https://www.facebook.com/${INSTAGRAM_GRAPH_VERSION}/dialog/oauth`);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "app-1",
    redirect_uri: "https://t.example/api/social/instagram/callback",
    state: "st",
    response_type: "code",
    scope: "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management",
  });
  assert.equal(INSTAGRAM_SCOPES.join(","), url.searchParams.get("scope"));
  assert.equal(connector.platform, "instagram");
});

test("exchangeCode swaps the code for a short-lived token, then a long-lived one, and picks the linked IG account", async () => {
  const { fetch, calls } = fakeFetch([{ body: shortLived }, { body: longLived }, { body: pages }]);
  const connector = createInstagramConnector({ appId: "app-1", appSecret: "app-secret", fetch, now: () => NOW });
  const result = await connector.exchangeCode({ code: "the-code", codeVerifier: "unused", redirectUri: "https://t.example/cb" });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.split("?")[0], INSTAGRAM_ENDPOINTS.token);
  assert.deepEqual(searchParams(calls[0].url), {
    client_id: "app-1", client_secret: "app-secret", redirect_uri: "https://t.example/cb", code: "the-code",
  });
  assert.equal(calls[1].url.split("?")[0], INSTAGRAM_ENDPOINTS.token);
  assert.deepEqual(searchParams(calls[1].url), {
    grant_type: "fb_exchange_token", client_id: "app-1", client_secret: "app-secret", fb_exchange_token: "EAA.short-secret",
  });
  assert.equal(calls[2].url, INSTAGRAM_ENDPOINTS.pages);
  assert.equal(new Headers(calls[2].init.headers).get("authorization"), "Bearer EAA.long-secret");
  assert.equal(calls[2].url.includes("EAA."), false);

  assert.deepEqual(result, {
    profile: { externalAccountId: "ig-1", displayName: "gentleman.programming", scopes: [...INSTAGRAM_SCOPES] },
    tokens: { accessToken: "EAA.long-secret", expiresAt: "2026-12-20T12:00:00.000Z" },
  });
});

test("a user without a linked Instagram professional account gets a specific error", async () => {
  const { fetch } = fakeFetch([{ body: shortLived }, { body: longLived }, { body: { data: [{ id: "page-1", name: "No IG page" }] } }]);
  const connector = createInstagramConnector({ appId: "app-1", appSecret: "app-secret", fetch });
  await assert.rejects(connector.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r" }), (error: Error) => {
    assert.ok(error instanceof InstagramNoBusinessAccountError);
    assert.match(error.message, /professional/i);
    assert.doesNotMatch(error.message, /EAA\./);
    return true;
  });
});

test("refreshTokens re-exchanges the long-lived token", async () => {
  const { fetch, calls } = fakeFetch([{ body: { ...longLived, access_token: "EAA.new", expires_in: 3600 } }]);
  const connector = createInstagramConnector({ appId: "app-1", appSecret: "app-secret", fetch, now: () => NOW });
  const tokens = await connector.refreshTokens({ accessToken: "EAA.old", expiresAt: "2026-10-25T00:00:00.000Z" });
  assert.deepEqual(searchParams(calls[0].url), {
    grant_type: "fb_exchange_token", client_id: "app-1", client_secret: "app-secret", fb_exchange_token: "EAA.old",
  });
  assert.deepEqual(tokens, { accessToken: "EAA.new", expiresAt: "2026-10-21T13:00:00.000Z" });
});

test("provider errors throw a safe message without tokens, secrets or provider descriptions", async () => {
  const oauthError = { error: { message: "Invalid code EAA.short-secret app-secret leaked", type: "OAuthException", code: 100, fbtrace_id: "t" } };
  const { fetch } = fakeFetch([{ status: 400, body: oauthError }]);
  const connector = createInstagramConnector({ appId: "app-1", appSecret: "app-secret", fetch });
  await assert.rejects(connector.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r" }), (error: Error) => {
    assert.match(error.message, /Instagram token request failed \(HTTP 400\): OAuthException code 100/);
    assert.doesNotMatch(error.message, /secret|leaked|EAA\./);
    return true;
  });

  const pagesFailure = fakeFetch([
    { body: shortLived }, { body: longLived },
    { status: 400, body: { error: { message: "token EAA.long-secret", type: "OAuthException", code: 190 } } },
  ]);
  const connector2 = createInstagramConnector({ appId: "app-1", appSecret: "app-secret", fetch: pagesFailure.fetch });
  await assert.rejects(connector2.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r" }), (error: Error) => {
    assert.ok(!(error instanceof InstagramNoBusinessAccountError));
    assert.match(error.message, /Instagram pages request failed \(HTTP 400\): OAuthException code 190/);
    assert.doesNotMatch(error.message, /EAA\./);
    return true;
  });
});

test("createInstagramConnectorFromEnv requires the app credentials", () => {
  assert.throws(() => createInstagramConnectorFromEnv({}), /INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET/);
  assert.throws(() => createInstagramConnectorFromEnv({ INSTAGRAM_APP_ID: "a" }), /INSTAGRAM_APP_SECRET/);
  assert.equal(createInstagramConnectorFromEnv({ INSTAGRAM_APP_ID: "a", INSTAGRAM_APP_SECRET: "s" }).platform, "instagram");
});
