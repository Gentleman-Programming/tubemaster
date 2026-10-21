import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSocialOAuthCookie,
  createSocialOAuthState,
  readCookie,
  serializeSocialOAuthCookie,
  socialOAuthCookieName,
  socialOAuthCookieOptions,
  socialRedirectUri,
  verifySocialOAuthState,
} from "../oauth-state";

const SECRET = "test-nextauth-secret-value";
const NOW = new Date("2026-10-21T12:00:00.000Z");
const base = { platform: "tiktok" as const, state: "state-1", codeVerifier: "verifier-1", userId: "user-1" };

function sign() {
  return createSocialOAuthState({ ...base, secret: SECRET, now: NOW });
}

function verify(value: string, overrides: Partial<{ platform: "tiktok" | "instagram"; state: string; userId: string; secret: string; now: Date }> = {}) {
  return verifySocialOAuthState(value, { platform: "tiktok", state: "state-1", userId: "user-1", secret: SECRET, now: NOW, ...overrides });
}

test("a signed state round-trips and returns the code verifier", () => {
  const value = sign();
  assert.match(value, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(verify(value), { codeVerifier: "verifier-1" });
});

test("verification accepts until expiry and rejects after 10 minutes", () => {
  const value = sign();
  assert.ok(verify(value, { now: new Date(NOW.getTime() + 599_000) }));
  assert.equal(verify(value, { now: new Date(NOW.getTime() + 600_001) }), null);
});

test("verification rejects tampering, wrong secret, wrong platform, user or state", () => {
  const value = sign();
  const [payload, signature] = value.split(".");
  const forged = Buffer.from(JSON.stringify({ ...base, userId: "attacker", exp: NOW.getTime() + 600_000 })).toString("base64url");
  assert.equal(verify(`${forged}.${signature}`), null);
  assert.equal(verify(`${payload}.${signature.slice(0, -2)}xx`), null);
  assert.equal(verify(value, { secret: "other-secret" }), null);
  assert.equal(verify(value, { platform: "instagram" }), null);
  assert.equal(verify(value, { userId: "user-2" }), null);
  assert.equal(verify(value, { state: "state-2" }), null);
  assert.equal(verify(value, { state: "" }), null);
  assert.equal(verify(""), null);
  assert.equal(verify("not-a-token"), null);
  assert.equal(verify(`${Buffer.from("[]").toString("base64url")}.abc`), null);
});

test("signing requires a secret", () => {
  assert.throws(() => createSocialOAuthState({ ...base, secret: "", now: NOW }), /secret/i);
});

test("redirect URI prefers SOCIAL_OAUTH_BASE_URL, trims slashes and requires a base URL", () => {
  assert.equal(
    socialRedirectUri("tiktok", { SOCIAL_OAUTH_BASE_URL: "https://tunnel.example.com/", NEXTAUTH_URL: "http://localhost:3102" }),
    "https://tunnel.example.com/api/social/tiktok/callback",
  );
  assert.equal(socialRedirectUri("instagram", { NEXTAUTH_URL: "http://localhost:3102" }), "http://localhost:3102/api/social/instagram/callback");
  assert.throws(() => socialRedirectUri("tiktok", {}), /SOCIAL_OAUTH_BASE_URL or NEXTAUTH_URL/);
});

test("cookie is httpOnly, lax, scoped to /api/social, short-lived and secure only on https", () => {
  assert.equal(socialOAuthCookieName("tiktok"), "social_oauth_tiktok");
  assert.deepEqual(socialOAuthCookieOptions({ NEXTAUTH_URL: "http://localhost:3102" }), {
    httpOnly: true, sameSite: "lax", path: "/api/social", secure: false, maxAge: 600,
  });
  const header = serializeSocialOAuthCookie("tiktok", "abc.def", { SOCIAL_OAUTH_BASE_URL: "https://tunnel.example.com" });
  assert.equal(header, "social_oauth_tiktok=abc.def; Path=/api/social; Max-Age=600; HttpOnly; SameSite=Lax; Secure");
  assert.equal(
    clearSocialOAuthCookie("tiktok", { NEXTAUTH_URL: "http://localhost:3102" }),
    "social_oauth_tiktok=; Path=/api/social; Max-Age=0; HttpOnly; SameSite=Lax",
  );
});

test("readCookie extracts one cookie from the request header", () => {
  const request = new Request("http://localhost/api/social/tiktok/callback", {
    headers: { cookie: "a=1; social_oauth_tiktok=abc.def; b=2" },
  });
  assert.equal(readCookie(request, "social_oauth_tiktok"), "abc.def");
  assert.equal(readCookie(request, "missing"), undefined);
  assert.equal(readCookie(new Request("http://localhost/"), "a"), undefined);
});
