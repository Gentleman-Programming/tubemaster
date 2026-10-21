import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client } from "@libsql/client";
import type { SocialPostStatus } from "../contracts";
import { createSocialStorage, initializeSocialTables } from "../storage";

const SECRET = "test-nextauth-secret-value";
const FIXED_NOW = new Date("2026-10-21T12:00:00.000Z");

async function setup() {
  const client = createClient({ url: ":memory:" });
  await initializeSocialTables(client);
  const storage = createSocialStorage({ client, secret: SECRET, now: () => FIXED_NOW });
  return { client, storage };
}

const profile = {
  externalAccountId: "ig-user-1",
  displayName: "@gentleman",
  scopes: ["instagram_business_content_publish", "instagram_business_basic"],
};

async function tableNames(client: Client) {
  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name",
  );
  return result.rows.map((row) => String(row.name));
}

test("initializeSocialTables is idempotent and creates tables and the due index", async () => {
  const client = createClient({ url: ":memory:" });
  await initializeSocialTables(client);
  await initializeSocialTables(client);

  const names = await tableNames(client);
  assert.ok(names.includes("social_accounts"));
  assert.ok(names.includes("social_posts"));
  assert.ok(names.includes("idx_social_posts_status_scheduled"));
  client.close();
});

test("accounts can be upserted, read, listed and deleted per user", async () => {
  const { client, storage } = await setup();

  const account = await storage.upsertAccount("user-1", "instagram", profile, {
    accessToken: "ig-access-plain",
    refreshToken: "ig-refresh-plain",
    expiresAt: "2026-10-21T14:00:00.000Z",
  });
  assert.deepEqual(await storage.getAccount("user-1", "instagram"), account);
  assert.equal(account.userId, "user-1");
  assert.equal(account.platform, "instagram");
  assert.equal(account.externalAccountId, "ig-user-1");
  assert.equal(account.displayName, "@gentleman");
  assert.deepEqual(account.scopes, ["instagram_business_content_publish", "instagram_business_basic"]);
  assert.equal(account.tokenExpiresAt, "2026-10-21T14:00:00.000Z");
  assert.equal(account.connectedAt, FIXED_NOW.toISOString());
  assert.ok(!("accessToken" in account));
  assert.ok(!("refreshToken" in account));

  await storage.upsertAccount("user-1", "tiktok", { ...profile, externalAccountId: "tt-1" }, {
    accessToken: "tt-access",
  });
  await storage.upsertAccount("user-2", "instagram", { ...profile, externalAccountId: "ig-user-2" }, {
    accessToken: "other-access",
  });

  const listed = await storage.listAccounts("user-1");
  assert.deepEqual(listed.map((item) => item.platform).sort(), ["instagram", "tiktok"]);
  assert.equal(await storage.getAccount("user-2", "tiktok"), null);

  assert.equal(await storage.deleteAccount("user-1", "instagram"), true);
  assert.equal(await storage.deleteAccount("user-1", "instagram"), false);
  assert.equal(await storage.getAccount("user-1", "instagram"), null);
  assert.ok(await storage.getAccount("user-2", "instagram"));
  client.close();
});

test("tokens are stored encrypted and decrypted only through getAccountTokens", async () => {
  const { client, storage } = await setup();
  const account = await storage.upsertAccount("user-1", "instagram", profile, {
    accessToken: "ig-access-plain",
    refreshToken: "ig-refresh-plain",
    expiresAt: "2026-10-21T14:00:00.000Z",
  });

  const raw = await client.execute({
    sql: "SELECT * FROM social_accounts WHERE id = ?",
    args: [account.id],
  });
  const serialized = JSON.stringify(raw.rows[0]);
  assert.ok(!serialized.includes("ig-access-plain"));
  assert.ok(!serialized.includes("ig-refresh-plain"));
  assert.match(String(raw.rows[0].access_token_enc), /^v1\./);
  assert.match(String(raw.rows[0].refresh_token_enc), /^v1\./);

  assert.deepEqual(await storage.getAccountTokens(account.id), {
    accessToken: "ig-access-plain",
    refreshToken: "ig-refresh-plain",
    expiresAt: "2026-10-21T14:00:00.000Z",
  });
  assert.equal(await storage.getAccountTokens("missing-account"), null);

  const wrongKey = createSocialStorage({ client, secret: "another-secret" });
  await assert.rejects(() => wrongKey.getAccountTokens(account.id), /Social token decryption failed/);
  client.close();
});

test("updateAccountTokens replaces tokens and keeps the refresh token when none is returned", async () => {
  const { client, storage } = await setup();
  const account = await storage.upsertAccount("user-1", "instagram", profile, {
    accessToken: "old-access",
    refreshToken: "old-refresh",
  });

  assert.equal(
    await storage.updateAccountTokens(account.id, {
      accessToken: "new-access",
      expiresAt: "2026-10-21T16:00:00.000Z",
    }),
    true,
  );
  assert.deepEqual(await storage.getAccountTokens(account.id), {
    accessToken: "new-access",
    refreshToken: "old-refresh",
    expiresAt: "2026-10-21T16:00:00.000Z",
  });
  assert.equal((await storage.getAccount("user-1", "instagram"))?.tokenExpiresAt, "2026-10-21T16:00:00.000Z");

  await storage.updateAccountTokens(account.id, { accessToken: "newer-access", refreshToken: "new-refresh" });
  assert.deepEqual(await storage.getAccountTokens(account.id), {
    accessToken: "newer-access",
    refreshToken: "new-refresh",
  });
  assert.equal(await storage.updateAccountTokens("missing-account", { accessToken: "a" }), false);
  client.close();
});

test("upsertAccount keeps one account per platform per user", async () => {
  const { client, storage } = await setup();
  const first = await storage.upsertAccount("user-1", "instagram", profile, { accessToken: "first-access" });
  const second = await storage.upsertAccount(
    "user-1",
    "instagram",
    { externalAccountId: "ig-user-9", displayName: "@other", scopes: ["instagram_business_content_publish"] },
    { accessToken: "second-access" },
  );

  assert.equal(second.id, first.id);
  assert.equal(second.externalAccountId, "ig-user-9");
  assert.equal(second.displayName, "@other");
  assert.equal(second.tokenExpiresAt, null);
  assert.equal((await storage.listAccounts("user-1")).length, 1);
  assert.deepEqual(await storage.getAccountTokens(first.id), { accessToken: "second-access" });

  const count = await client.execute("SELECT COUNT(*) AS total FROM social_accounts");
  assert.equal(Number(count.rows[0].total), 1);
  client.close();
});

function newPost(userId: string, accountId: string, overrides: Partial<{ status: SocialPostStatus; scheduledAtUtc: string }> = {}) {
  return {
    userId,
    accountId,
    platform: "tiktok" as const,
    stagingFile: "staging/video.mp4",
    caption: "New video",
    platformOptions: { privacyLevel: "SELF_ONLY" },
    scheduledAtUtc: overrides.scheduledAtUtc ?? "2026-10-22T15:00:00.000Z",
    timezone: "America/Argentina/Buenos_Aires",
    status: overrides.status ?? ("scheduled" as const),
  };
}

test("posts are inserted, read and listed scoped by user", async () => {
  const { client, storage } = await setup();
  const mine = await storage.insertPost(newPost("user-1", "account-1"));
  const later = await storage.insertPost(
    newPost("user-1", "account-1", { status: "draft", scheduledAtUtc: "2026-10-23T15:00:00.000Z" }),
  );
  const theirs = await storage.insertPost(newPost("user-2", "account-2"));

  assert.equal(mine.status, "scheduled");
  assert.deepEqual(mine.platformOptions, { privacyLevel: "SELF_ONLY" });
  assert.equal(mine.createdAt, FIXED_NOW.toISOString());
  assert.equal(mine.updatedAt, FIXED_NOW.toISOString());
  assert.equal(mine.externalPostId, undefined);
  assert.equal(mine.error, undefined);
  assert.equal(mine.publishedAt, undefined);
  assert.deepEqual(await storage.getPost("user-1", mine.id), mine);

  assert.equal(await storage.getPost("user-1", theirs.id), null);
  assert.deepEqual(
    (await storage.listPosts("user-1")).map((post) => post.id),
    [mine.id, later.id],
  );
  assert.deepEqual(
    (await storage.listPosts("user-1", { statuses: ["draft"] })).map((post) => post.id),
    [later.id],
  );
  assert.deepEqual(
    (await storage.listPosts("user-2")).map((post) => post.id),
    [theirs.id],
  );
  client.close();
});

test("transitionPost changes status only from the allowed statuses", async () => {
  const { client, storage } = await setup();
  const post = await storage.insertPost(newPost("user-1", "account-1"));

  assert.equal(await storage.transitionPost(post.id, ["scheduled"], "publishing"), true);
  assert.equal(await storage.transitionPost(post.id, ["scheduled"], "publishing"), false);
  assert.equal((await storage.getPost("user-1", post.id))?.status, "publishing");

  assert.equal(
    await storage.transitionPost(post.id, ["publishing"], "published", {
      externalPostId: "ext-42",
      publishedAt: "2026-10-22T15:00:05.000Z",
    }),
    true,
  );
  const published = await storage.getPost("user-1", post.id);
  assert.equal(published?.status, "published");
  assert.equal(published?.externalPostId, "ext-42");
  assert.equal(published?.publishedAt, "2026-10-22T15:00:05.000Z");

  const failing = await storage.insertPost(newPost("user-1", "account-1"));
  await storage.transitionPost(failing.id, ["scheduled"], "publishing");
  await storage.transitionPost(failing.id, ["publishing"], "failed", {
    error: { code: "upload_failed", message: "Upload rejected" },
  });
  assert.deepEqual((await storage.getPost("user-1", failing.id))?.error, {
    code: "upload_failed",
    message: "Upload rejected",
  });

  assert.equal(await storage.transitionPost("missing-post", ["scheduled"], "publishing"), false);
  client.close();
});

test("unknown statuses and platforms are rejected", async () => {
  const { client, storage } = await setup();
  const post = await storage.insertPost(newPost("user-1", "account-1"));

  await assert.rejects(
    () => storage.transitionPost(post.id, ["scheduled"], "done" as SocialPostStatus),
    /Unknown social post status/,
  );
  await assert.rejects(
    () => storage.transitionPost(post.id, ["bogus" as SocialPostStatus], "publishing"),
    /Unknown social post status/,
  );
  await assert.rejects(
    () => storage.transitionPost(post.id, [], "publishing"),
    /at least one status/,
  );
  await assert.rejects(
    () => storage.insertPost({ ...newPost("user-1", "account-1"), status: "done" as SocialPostStatus }),
    /Unknown social post status/,
  );
  await assert.rejects(
    () => storage.listPosts("user-1", { statuses: ["done" as SocialPostStatus] }),
    /Unknown social post status/,
  );
  await assert.rejects(
    () => storage.upsertAccount("user-1", "x" as "instagram", profile, { accessToken: "a" }),
    /Unknown social platform/,
  );
  assert.equal((await storage.getPost("user-1", post.id))?.status, "scheduled");
  client.close();
});

test("initializeDatabase still creates the existing tables plus the social tables", async () => {
  // db.ts opens `<cwd>/data/playlist-manager.db` on import, so point cwd at a temp directory.
  const originalCwd = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "tubemaster-db-"));
  mkdirSync(join(directory, "data"));
  process.chdir(directory);
  try {
    const { databaseInitialization, quotaClient } = await import("../../db");
    await databaseInitialization;
    const names = await tableNames(quotaClient);
    for (const table of ["users", "rules", "quota_entries", "social_accounts", "social_posts"]) {
      assert.ok(names.includes(table), `missing table ${table}`);
    }
    const userColumns = await quotaClient.execute("PRAGMA table_info(users)");
    assert.deepEqual(
      userColumns.rows.map((row) => String(row.name)),
      ["id", "name", "email", "image", "access_token", "refresh_token", "token_expiry", "oauth_scope", "selected_channel_id"],
    );
    quotaClient.close();
  } finally {
    process.chdir(originalCwd);
    rmSync(directory, { recursive: true, force: true });
  }
});
