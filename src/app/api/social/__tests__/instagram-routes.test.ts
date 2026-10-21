import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import type { SocialOAuthConnector } from "../../../../lib/social/contracts";
import { createSocialOAuthState } from "../../../../lib/social/oauth-state";
import { InstagramNoBusinessAccountError } from "../../../../lib/social/platforms/instagram/connector";
import { createSocialStorage, initializeSocialTables } from "../../../../lib/social/storage";
import { createInstagramCallbackHandler } from "../instagram/callback/route";
import { createInstagramConnectHandler } from "../instagram/connect/route";

const SECRET = "test-nextauth-secret-value";
const NOW = new Date("2026-10-21T12:00:00.000Z");
const ENV = { NEXTAUTH_URL: "http://localhost:3102" };
const REDIRECT_URI = "http://localhost:3102/api/social/instagram/callback";
const session = async () => ({ user: { id: "user-1" } });
const noSession = async () => null;

function fakeConnector() {
  const exchanges: Array<{ code: string; codeVerifier: string; redirectUri: string }> = [];
  const connector: SocialOAuthConnector = {
    platform: "instagram",
    authorizationUrl: ({ state, redirectUri }) =>
      `https://www.facebook.com/v21.0/dialog/oauth?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async (args) => {
      exchanges.push(args);
      return {
        profile: { externalAccountId: "ig-1", displayName: "gentleman.programming", scopes: ["instagram_basic", "instagram_content_publish"] },
        tokens: { accessToken: "EAA.long-secret", expiresAt: "2026-12-20T12:00:00.000Z" },
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

function stateCookie(overrides: Partial<{ state: string; userId: string; now: Date; platform: "instagram" | "tiktok" }> = {}) {
  return createSocialOAuthState({
    platform: overrides.platform ?? "instagram", state: overrides.state ?? "state-1", codeVerifier: "verifier-1",
    userId: overrides.userId ?? "user-1", secret: SECRET, now: overrides.now ?? NOW,
  });
}

function callbackRequest(query: string, cookie?: string) {
  return new Request(`http://localhost:3102/api/social/instagram/callback?${query}`, {
    headers: cookie ? { cookie: `social_oauth_instagram=${cookie}` } : {},
  });
}

test("connect requires a session", async () => {
  const { loadConfig } = await setup();
  const GET = createInstagramConnectHandler({ getSession: noSession, loadConfig });
  assert.equal((await GET(new Request("http://localhost:3102/api/social/instagram/connect"))).status, 401);
});

test("connect sets the signed state cookie and redirects to Facebook Login", async () => {
  const { loadConfig } = await setup();
  const GET = createInstagramConnectHandler({
    getSession: session, loadConfig, now: () => NOW,
    generateState: () => "state-1", generatePkce: () => ({ verifier: "verifier-1", challenge: "challenge-1" }),
  });
  const response = await GET(new Request("http://localhost:3102/api/social/instagram/connect"));
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location") ?? "");
  assert.equal(location.origin, "https://www.facebook.com");
  assert.equal(location.searchParams.get("state"), "state-1");
  assert.equal(location.searchParams.get("redirect_uri"), REDIRECT_URI);
  const cookie = response.headers.get("set-cookie") ?? "";
  assert.equal(cookie.includes("verifier-1"), false);
  assert.equal(cookie, `social_oauth_instagram=${stateCookie()}; Path=/api/social; Max-Age=600; HttpOnly; SameSite=Lax`);
});

test("connect redirects with not_configured when Instagram credentials are missing", async () => {
  const GET = createInstagramConnectHandler({ getSession: session, loadConfig: () => { throw new Error("INSTAGRAM_APP_ID missing"); } });
  const response = await GET(new Request("http://localhost:3102/api/social/instagram/connect"));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost:3102/dashboard/social?error=not_configured");
});

test("callback exchanges the code, stores the account and clears the cookie", async () => {
  const { storage, exchanges, loadConfig, client } = await setup();
  const GET = createInstagramCallbackHandler({ getSession: session, loadConfig, storage: async () => storage, now: () => NOW });
  const response = await GET(callbackRequest("code=the-code&state=state-1", stateCookie()));

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "http://localhost:3102/dashboard/social?connected=instagram");
  assert.equal(response.headers.get("set-cookie"), "social_oauth_instagram=; Path=/api/social; Max-Age=0; HttpOnly; SameSite=Lax");
  assert.deepEqual(exchanges, [{ code: "the-code", codeVerifier: "verifier-1", redirectUri: REDIRECT_URI }]);

  const account = await storage.getAccount("user-1", "instagram");
  assert.equal(account?.externalAccountId, "ig-1");
  assert.equal(account?.displayName, "gentleman.programming");
  const raw = await client.execute("SELECT access_token_enc FROM social_accounts");
  assert.equal(String(raw.rows[0].access_token_enc).includes("EAA.long-secret"), false);
});

test("callback state failures redirect with invalid_state and store nothing", async () => {
  const cases: Array<[string, string, string | undefined]> = [
    ["bad state", "code=c&state=other", stateCookie()],
    ["other user", "code=c&state=state-1", stateCookie({ userId: "user-2" })],
    ["other platform", "code=c&state=state-1", stateCookie({ platform: "tiktok" })],
    ["expired cookie", "code=c&state=state-1", stateCookie({ now: new Date(NOW.getTime() - 11 * 60_000) })],
    ["missing cookie", "code=c&state=state-1", undefined],
    ["missing code", "state=state-1", stateCookie()],
  ];
  for (const [label, query, cookie] of cases) {
    const { storage, exchanges, loadConfig } = await setup();
    const GET = createInstagramCallbackHandler({ getSession: session, loadConfig, storage: async () => storage, now: () => NOW });
    const response = await GET(callbackRequest(query, cookie));
    assert.equal(response.status, 302, label);
    assert.equal(response.headers.get("location"), "http://localhost:3102/dashboard/social?error=invalid_state", label);
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/, label);
    assert.equal(exchanges.length, 0, label);
    assert.deepEqual(await storage.listAccounts("user-1"), [], label);
  }
});

test("callback handles denial, missing business account and exchange failures without leaking details", async () => {
  const { storage, exchanges, loadConfig, connector } = await setup();
  const GET = createInstagramCallbackHandler({ getSession: session, loadConfig, storage: async () => storage, now: () => NOW });
  const denied = await GET(callbackRequest("error=access_denied&error_reason=user_denied&state=state-1", stateCookie()));
  assert.equal(denied.headers.get("location"), "http://localhost:3102/dashboard/social?error=access_denied");
  assert.equal(exchanges.length, 0);

  connector.exchangeCode = async () => { throw new InstagramNoBusinessAccountError(); };
  const noBusiness = await GET(callbackRequest("code=c&state=state-1", stateCookie()));
  assert.equal(noBusiness.headers.get("location"), "http://localhost:3102/dashboard/social?error=no_instagram_business_account");

  connector.exchangeCode = async () => { throw new Error("Instagram token request failed (HTTP 400): OAuthException code 100"); };
  const failed = await GET(callbackRequest("code=c&state=state-1", stateCookie()));
  assert.equal(failed.headers.get("location"), "http://localhost:3102/dashboard/social?error=exchange_failed");
  assert.deepEqual(await storage.listAccounts("user-1"), []);

  const unauthenticated = createInstagramCallbackHandler({ getSession: noSession, loadConfig, storage: async () => storage });
  assert.equal((await unauthenticated(callbackRequest("code=c&state=state-1", stateCookie()))).status, 401);
});
