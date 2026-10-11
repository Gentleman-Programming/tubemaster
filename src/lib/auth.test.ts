import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoogleLoopbackAuthUrl,
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_ANALYTICS_READ_SCOPE,
  YOUTUBE_SCOPES,
} from "./auth";

test("default YouTube scopes include youtube.force-ssl", () => {
  assert.equal(YOUTUBE_SCOPES.includes(YOUTUBE_FORCE_SSL_SCOPE), true);
});

test("analytics scope is opt-in and default YouTube scopes remain unchanged", () => {
  assert.equal(YOUTUBE_ANALYTICS_READ_SCOPE, "https://www.googleapis.com/auth/yt-analytics.readonly");
  assert.deepEqual(YOUTUBE_SCOPES, [
    "openid", "email", "profile",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube",
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ]);
  assert.equal(YOUTUBE_SCOPES.includes(YOUTUBE_ANALYTICS_READ_SCOPE as typeof YOUTUBE_SCOPES[number]), false);
});

test("buildGoogleLoopbackAuthUrl includes redirect_uri in generated URL", () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

  const redirectUri = "http://127.0.0.1:43123";
  const authUrl = buildGoogleLoopbackAuthUrl({
    redirectUri,
    state: "test-state",
    codeChallenge: "test-challenge",
  });

  const url = new URL(authUrl);

  assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(url.searchParams.get("state"), "test-state");
  assert.equal(url.searchParams.get("code_challenge"), "test-challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    decodeURIComponent(url.searchParams.get("scope") ?? "").includes(YOUTUBE_FORCE_SSL_SCOPE),
    true
  );
});
