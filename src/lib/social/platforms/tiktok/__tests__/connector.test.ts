import assert from "node:assert/strict";
import test from "node:test";
import { createTikTokConnector } from "../connector";
import { TIKTOK_ENDPOINTS, TIKTOK_SCOPES } from "../endpoints";

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

const tokenBody = {
  access_token: "act.secret-access",
  expires_in: 86400,
  open_id: "open-1",
  refresh_token: "rft.secret-refresh",
  refresh_expires_in: 31536000,
  scope: "user.info.basic,video.publish",
  token_type: "Bearer",
};
const userBody = { data: { user: { open_id: "open-1", display_name: "Gentleman" } }, error: { code: "ok", message: "", log_id: "l" } };
const NOW = new Date("2026-10-21T12:00:00.000Z");

test("authorizationUrl includes client key, scopes, PKCE S256 and redirect", () => {
  const connector = createTikTokConnector({ clientKey: "ck", clientSecret: "cs", fetch: fakeFetch([]).fetch });
  const url = new URL(connector.authorizationUrl({ state: "st", codeChallenge: "chal", redirectUri: "https://t.example/api/social/tiktok/callback" }));
  assert.equal(`${url.origin}${url.pathname}`, TIKTOK_ENDPOINTS.authorize);
  assert.equal(url.searchParams.get("client_key"), "ck");
  assert.equal(url.searchParams.get("scope"), TIKTOK_SCOPES.join(","));
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://t.example/api/social/tiktok/callback");
  assert.equal(url.searchParams.get("state"), "st");
  assert.equal(url.searchParams.get("code_challenge"), "chal");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("client_secret"), null);
  assert.equal(connector.platform, "tiktok");
});

test("exchangeCode posts a form-encoded token request and maps the profile", async () => {
  const { fetch, calls } = fakeFetch([{ body: tokenBody }, { body: userBody }]);
  const connector = createTikTokConnector({ clientKey: "ck", clientSecret: "cs", fetch, now: () => NOW });
  const result = await connector.exchangeCode({ code: "the-code", codeVerifier: "verifier", redirectUri: "https://t.example/cb" });

  assert.equal(calls[0].url, TIKTOK_ENDPOINTS.token);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(new Headers(calls[0].init.headers).get("content-type"), "application/x-www-form-urlencoded");
  const form = new URLSearchParams(String(calls[0].init.body));
  assert.deepEqual(Object.fromEntries(form), {
    client_key: "ck", client_secret: "cs", code: "the-code", grant_type: "authorization_code",
    redirect_uri: "https://t.example/cb", code_verifier: "verifier",
  });

  assert.equal(calls[1].url, TIKTOK_ENDPOINTS.userInfo);
  assert.equal(new Headers(calls[1].init.headers).get("authorization"), "Bearer act.secret-access");

  assert.deepEqual(result, {
    profile: { externalAccountId: "open-1", displayName: "Gentleman", scopes: ["user.info.basic", "video.publish"] },
    tokens: { accessToken: "act.secret-access", refreshToken: "rft.secret-refresh", expiresAt: "2026-10-22T12:00:00.000Z" },
  });
});

test("refreshTokens uses the refresh_token grant", async () => {
  const { fetch, calls } = fakeFetch([{ body: { ...tokenBody, access_token: "act.new", refresh_token: "rft.new", expires_in: 3600 } }]);
  const connector = createTikTokConnector({ clientKey: "ck", clientSecret: "cs", fetch, now: () => NOW });
  const tokens = await connector.refreshTokens({ accessToken: "act.old", refreshToken: "rft.old" });
  assert.deepEqual(Object.fromEntries(new URLSearchParams(String(calls[0].init.body))), {
    client_key: "ck", client_secret: "cs", grant_type: "refresh_token", refresh_token: "rft.old",
  });
  assert.deepEqual(tokens, { accessToken: "act.new", refreshToken: "rft.new", expiresAt: "2026-10-21T13:00:00.000Z" });
  await assert.rejects(connector.refreshTokens({ accessToken: "act.old" }), /refresh token/i);
});

test("provider errors throw a safe message without tokens, secrets or provider descriptions", async () => {
  const { fetch } = fakeFetch([{ status: 400, body: { error: "invalid_grant", error_description: "code act.secret-access cs leaked", log_id: "x" } }]);
  const connector = createTikTokConnector({ clientKey: "ck", clientSecret: "cs-very-secret", fetch });
  await assert.rejects(connector.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r" }), (error: Error) => {
    assert.match(error.message, /TikTok token request failed/);
    assert.match(error.message, /invalid_grant/);
    assert.doesNotMatch(error.message, /secret|leaked|act\./);
    return true;
  });

  const userInfoFailure = fakeFetch([{ body: tokenBody }, { body: { data: {}, error: { code: "access_token_invalid", message: "act.secret-access" } } }]);
  const connector2 = createTikTokConnector({ clientKey: "ck", clientSecret: "cs", fetch: userInfoFailure.fetch });
  await assert.rejects(connector2.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "r" }), (error: Error) => {
    assert.match(error.message, /TikTok user info request failed: access_token_invalid/);
    assert.doesNotMatch(error.message, /act\./);
    return true;
  });
});
