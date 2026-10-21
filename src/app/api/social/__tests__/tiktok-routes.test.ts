import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import type { SocialOAuthConnector } from "../../../../lib/social/contracts";
import { createSocialOAuthState } from "../../../../lib/social/oauth-state";
import { createSocialStorage, initializeSocialTables } from "../../../../lib/social/storage";
import { createSocialAccountsHandlers } from "../accounts/route";
import { createTikTokCallbackHandler } from "../tiktok/callback/route";
import { createTikTokConnectHandler } from "../tiktok/connect/route";

const SECRET = "test-nextauth-secret-value";
const NOW = new Date("2026-10-21T12:00:00.000Z");
const ENV = { NEXTAUTH_URL: "http://localhost:3102" };
const REDIRECT_URI = "http://localhost:3102/api/social/tiktok/callback";
const session = async () => ({ user: { id: "user-1" } });
const noSession = async () => null;

function fakeConnector() {
  const exchanges: Array<{ code: string; codeVerifier: string; redirectUri: string }> = [];
  const connector: SocialOAuthConnector = {
    platform: "tiktok",
    authorizationUrl: ({ state, codeChallenge, redirectUri }) =>
      `https://www.tiktok.com/v2/auth/authorize/?state=${state}&code_challenge=${codeChallenge}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async (args) => {
      exchanges.push(args);
      return {
        profile: { externalAccountId: "open-1", displayName: "Gentleman", scopes: ["user.info.basic", "video.publish"] },
        tokens: { accessToken: "act.secret", refreshToken: "rft.secret", expiresAt: "2026-10-22T12:00:00.000Z" },
      };
    },
    refreshTokens: async () => { throw new Error("unused"); },
  };
  return { connector, exchanges };
}

async function setup() {
  const client = createClient({ url: ":memory:" });
  await initializeSocialTables(client);
  const storage = createSocialStorage({ client, secret: SECRET, now: () => NOW });
  const { connector, exchanges } = fakeConnector();
  const loadConfig = () => ({ connector, redirectUri: REDIRECT_URI, secret: SECRET, env: ENV });
  return { client, storage, connector, exchanges, loadConfig };
}

function stateCookie(overrides: Partial<{ state: string; userId: string; now: Date }> = {}) {
  return createSocialOAuthState({
    platform: "tiktok", state: overrides.state ?? "state-1", codeVerifier: "verifier-1",
    userId: overrides.userId ?? "user-1", secret: SECRET, now: overrides.now ?? NOW,
  });
}

function callbackRequest(query: string, cookie?: string) {
  return new Request(`http://localhost:3102/api/social/tiktok/callback?${query}`, {
    headers: cookie ? { cookie: `social_oauth_tiktok=${cookie}` } : {},
  });
}

test("connect requires a session", async () => {
  const { loadConfig } = await setup();
  const GET = createTikTokConnectHandler({ getSession: noSession, loadConfig });
  assert.equal((await GET(new Request("http://localhost:3102/api/social/tiktok/connect"))).status, 401);
});

test("connect sets the signed state cookie and redirects to TikTok", async () => {
  const { loadConfig } = await setup();
  const GET = createTikTokConnectHandler({
    getSession: session, loadConfig, now: () => NOW,
    generateState: () => "state-1", generatePkce: () => ({ verifier: "verifier-1", challenge: "challenge-1" }),
  });
  const response = await GET(new Request("http://localhost:3102/api/social/tiktok/connect"));
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.searchParams.get("state"), "state-1");
  assert.equal(location.searchParams.get("code_challenge"), "challenge-1");
  assert.equal(location.searchParams.get("redirect_uri"), REDIRECT_URI);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^social_oauth_tiktok=[^;]+; Path=\/api\/social; Max-Age=600; HttpOnly; SameSite=Lax$/);
  assert.equal(cookie.includes("verifier-1"), false);
  assert.equal(cookie, `social_oauth_tiktok=${stateCookie()}; Path=/api/social; Max-Age=600; HttpOnly; SameSite=Lax`);
});

test("connect redirects with not_configured when TikTok credentials are missing", async () => {
  const GET = createTikTokConnectHandler({ getSession: session, loadConfig: () => { throw new Error("TIKTOK_CLIENT_KEY missing"); } });
  const response = await GET(new Request("http://localhost:3102/api/social/tiktok/connect"));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost:3102/dashboard/social?error=not_configured");
});

test("callback exchanges the code, stores the account and clears the cookie", async () => {
  const { storage, exchanges, loadConfig, client } = await setup();
  const GET = createTikTokCallbackHandler({ getSession: session, loadConfig, storage: async () => storage, now: () => NOW });
  const response = await GET(callbackRequest("code=the-code&state=state-1", stateCookie()));

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost:3102/dashboard/social?connected=tiktok");
  assert.equal(response.headers.get("set-cookie"), "social_oauth_tiktok=; Path=/api/social; Max-Age=0; HttpOnly; SameSite=Lax");
  assert.deepEqual(exchanges, [{ code: "the-code", codeVerifier: "verifier-1", redirectUri: REDIRECT_URI }]);

  const account = await storage.getAccount("user-1", "tiktok");
  assert.equal(account?.externalAccountId, "open-1");
  const raw = await client.execute("SELECT access_token_enc FROM social_accounts");
  assert.equal(String(raw.rows[0].access_token_enc).includes("act.secret"), false);
});

test("callback failures redirect with an error code and store nothing", async () => {
  const cases: Array<[string, string, string | undefined]> = [
    ["bad state", "code=c&state=other", stateCookie()],
    ["other user", "code=c&state=state-1", stateCookie({ userId: "user-2" })],
    ["expired cookie", "code=c&state=state-1", stateCookie({ now: new Date(NOW.getTime() - 11 * 60_000) })],
    ["missing cookie", "code=c&state=state-1", undefined],
    ["missing code", "state=state-1", stateCookie()],
  ];
  for (const [label, query, cookie] of cases) {
    const { storage, exchanges, loadConfig } = await setup();
    const GET = createTikTokCallbackHandler({ getSession: session, loadConfig, storage: async () => storage, now: () => NOW });
    const response = await GET(callbackRequest(query, cookie));
    assert.equal(response.status, 302, label);
    assert.equal(response.headers.get("location"), "http://localhost:3102/dashboard/social?error=invalid_state", label);
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/, label);
    assert.equal(exchanges.length, 0, label);
    assert.deepEqual(await storage.listAccounts("user-1"), [], label);
  }
});

test("callback handles a denied authorization and exchange failures without leaking details", async () => {
  const { storage, exchanges, loadConfig, connector } = await setup();
  const GET = createTikTokCallbackHandler({ getSession: session, loadConfig, storage: async () => storage, now: () => NOW });
  const denied = await GET(callbackRequest("error=access_denied&error_description=User%20canceled&state=state-1", stateCookie()));
  assert.equal(denied.headers.get("location"), "http://localhost:3102/dashboard/social?error=access_denied");
  assert.equal(exchanges.length, 0);

  connector.exchangeCode = async () => { throw new Error("TikTok token request failed (HTTP 400): invalid_grant"); };
  const failed = await GET(callbackRequest("code=c&state=state-1", stateCookie()));
  assert.equal(failed.headers.get("location"), "http://localhost:3102/dashboard/social?error=exchange_failed");
  assert.deepEqual(await storage.listAccounts("user-1"), []);

  const unauthenticated = createTikTokCallbackHandler({ getSession: noSession, loadConfig, storage: async () => storage });
  assert.equal((await unauthenticated(callbackRequest("code=c&state=state-1", stateCookie()))).status, 401);
});

test("accounts GET lists public fields only and DELETE disconnects", async () => {
  const { storage } = await setup();
  await storage.upsertAccount("user-1", "tiktok", { externalAccountId: "open-1", displayName: "Gentleman", scopes: ["video.publish"] }, {
    accessToken: "act.secret", refreshToken: "rft.secret", expiresAt: "2026-10-22T12:00:00.000Z",
  });
  const { GET, DELETE } = createSocialAccountsHandlers({ getSession: session, storage: async () => storage });

  const listed = await GET();
  assert.equal(listed.status, 200);
  const text = await listed.text();
  assert.equal(/act\.secret|rft\.secret|token_enc|accessToken|refreshToken/.test(text), false);
  const body = JSON.parse(text) as { accounts: Array<Record<string, unknown>> };
  assert.equal(body.accounts.length, 1);
  assert.deepEqual(Object.keys(body.accounts[0]).sort(), [
    "connectedAt", "displayName", "externalAccountId", "id", "platform", "scopes", "tokenExpiresAt", "userId",
  ]);

  const invalid = await DELETE(new Request("http://localhost:3102/api/social/accounts?platform=x", { method: "DELETE" }));
  assert.equal(invalid.status, 400);
  const removed = await DELETE(new Request("http://localhost:3102/api/social/accounts?platform=tiktok", { method: "DELETE" }));
  assert.deepEqual(await removed.json(), { deleted: true });
  assert.deepEqual(await storage.listAccounts("user-1"), []);

  const anonymous = createSocialAccountsHandlers({ getSession: noSession, storage: async () => storage });
  assert.equal((await anonymous.GET()).status, 401);
  assert.equal((await anonymous.DELETE(new Request("http://localhost:3102/api/social/accounts?platform=tiktok", { method: "DELETE" }))).status, 401);
});
