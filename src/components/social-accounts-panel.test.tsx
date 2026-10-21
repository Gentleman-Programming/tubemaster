import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SocialAccount } from "@/lib/social/contracts";
import { disconnectSocialAccount, requestSocialAccounts, SocialAccountsContent } from "./social-accounts-panel";

const tiktok: SocialAccount = {
  id: "acc-1",
  userId: "user-1",
  platform: "tiktok",
  externalAccountId: "open-1",
  displayName: "Gentleman TikTok",
  scopes: ["user.info.basic", "video.publish"],
  tokenExpiresAt: null,
  connectedAt: "2026-10-21T12:00:00.000Z",
};

test("requests the accounts endpoint", async () => {
  let requested = "";
  const view = await requestSocialAccounts(async (url) => {
    requested = url;
    return Response.json({ accounts: [tiktok] });
  });
  assert.equal(requested, "/api/social/accounts");
  assert.deepEqual(view, { kind: "result", accounts: [tiktok] });
});

test("maps account loading failures to an error view", async () => {
  const view = await requestSocialAccounts(async () => Response.json({ error: "unauthorized" }, { status: 401 }));
  assert.equal(view.kind, "error");
  if (view.kind === "error") assert.match(view.message, /Sign in again/);
});

test("disconnects with DELETE and the platform query", async () => {
  let call: { url: string; method?: string } | null = null;
  const result = await disconnectSocialAccount("instagram", async (url, init) => {
    call = { url, method: init?.method };
    return Response.json({ deleted: true });
  });
  assert.deepEqual(call, { url: "/api/social/accounts?platform=instagram", method: "DELETE" });
  assert.deepEqual(result, { ok: true });
});

test("renders connected and missing accounts with connect links", () => {
  const html = renderToStaticMarkup(
    <SocialAccountsContent view={{ kind: "result", accounts: [tiktok] }} loading={false} />,
  );
  assert.match(html, /Gentleman TikTok/);
  assert.match(html, /Disconnect/);
  assert.match(html, /href="\/api\/social\/instagram\/connect"/);
  assert.match(html, /Connect Instagram/);
  assert.match(html, /Reconnect TikTok/);
  assert.match(html, /href="\/api\/social\/tiktok\/connect"/);
});

test("renders the callback banners", () => {
  const connected = renderToStaticMarkup(
    <SocialAccountsContent view={{ kind: "result", accounts: [tiktok] }} loading={false} connected="tiktok" />,
  );
  assert.match(connected, /TikTok account connected\./);

  const failed = renderToStaticMarkup(
    <SocialAccountsContent view={{ kind: "result", accounts: [] }} loading={false} error="no_instagram_business_account" />,
  );
  assert.match(failed, /role="alert"/);
  assert.match(failed, /professional/);
});

test("renders loading and error states", () => {
  assert.match(renderToStaticMarkup(<SocialAccountsContent view={null} loading />), /Loading connected accounts/);
  const html = renderToStaticMarkup(<SocialAccountsContent view={{ kind: "error", message: "Boom." }} loading={false} />);
  assert.match(html, /Boom\./);
});
