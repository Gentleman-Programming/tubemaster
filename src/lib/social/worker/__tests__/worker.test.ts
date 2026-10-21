import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import {
  SocialPublishError,
  type SocialPlatform,
  type SocialPublishRequest,
  type SocialPublishResult,
  type SocialPublisher,
} from "../../contracts";
import { createSocialStorage, initializeSocialTables, type SocialStorage } from "../../storage";
import { createSocialWorker, type SocialWorkerDeps, type WorkerTimers } from "../worker";

const SECRET = "test-nextauth-secret-value";
const START = Date.parse("2026-10-21T12:00:00.000Z");
const MINUTE = 60_000;
const CONFIRMED_SHA256 = createHash("sha256").update("video-bytes").digest("hex");

type PublishCall = { request: SocialPublishRequest; snapshotBytes: string; snapshotMode: number; dirMode: number };

function fakePublisher(
  platform: SocialPlatform,
  behavior: (request: SocialPublishRequest) => Promise<SocialPublishResult> = async () => ({ externalPostId: "ext-1" }),
) {
  const calls: PublishCall[] = [];
  const publisher: SocialPublisher = {
    platform,
    async publish(request) {
      const info = await stat(request.videoPath);
      const dirInfo = await stat(join(request.videoPath, ".."));
      calls.push({
        request,
        snapshotBytes: await readFile(request.videoPath, "utf8"),
        snapshotMode: info.mode & 0o777,
        dirMode: dirInfo.mode & 0o777,
      });
      return behavior(request);
    },
  };
  return { publisher, calls };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(t: test.TestContext) {
  const stagingRoot = await mkdtemp(join(tmpdir(), "social-worker-"));
  t.after(() => rm(stagingRoot, { recursive: true, force: true }));
  await writeFile(join(stagingRoot, "clip.mp4"), "video-bytes");
  const clock = { now: START };
  const now = () => new Date(clock.now);
  const client = createClient({ url: ":memory:" });
  await initializeSocialTables(client);
  const storage = createSocialStorage({ client, secret: SECRET, now });
  const account = await storage.upsertAccount(
    "user-1",
    "tiktok",
    { externalAccountId: "tt-1", displayName: "@gentleman", scopes: ["video.publish"] },
    { accessToken: "access-1", refreshToken: "refresh-1" },
  );
  const logs: string[] = [];

  async function schedule(
    overrides: {
      userId?: string;
      accountId?: string;
      platform?: SocialPlatform;
      at?: number;
      stagingFile?: string;
      confirmedSha256?: string | null;
    } = {},
  ) {
    const inserted = await storage.insertPost({
      userId: overrides.userId ?? "user-1",
      accountId: overrides.accountId ?? account.id,
      platform: overrides.platform ?? "tiktok",
      stagingFile: overrides.stagingFile ?? "clip.mp4",
      caption: "New video",
      platformOptions: { privacyLevel: "SELF_ONLY" },
      scheduledAtUtc: new Date(overrides.at ?? START).toISOString(),
      timezone: "America/Argentina/Buenos_Aires",
      status: "scheduled",
    });
    // Mirrors confirm(): a scheduled post carries the hash of the bytes the user confirmed.
    const confirmedSha256 = overrides.confirmedSha256 === undefined ? CONFIRMED_SHA256 : overrides.confirmedSha256;
    if (confirmedSha256 !== null) {
      assert.ok(await storage.transitionPost(inserted.id, ["scheduled"], "scheduled", { confirmedSha256 }));
    }
    return inserted;
  }

  function worker(overrides: Partial<SocialWorkerDeps> = {}) {
    return createSocialWorker({
      client,
      storage,
      publishers: {},
      stagingRoot,
      now,
      logger: (message) => logs.push(message),
      ...overrides,
    });
  }

  const post = (id: string, userId = "user-1") => storage.getPost(userId, id);
  return { stagingRoot, clock, client, storage, account, logs, schedule, worker, post };
}

async function snapshotDirs(stagingRoot: string) {
  return (await readdir(stagingRoot)).filter((name) => name.startsWith(".social-snapshot-"));
}

test("publishes a due post once from a private snapshot and removes the snapshot", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const scheduled = await ctx.schedule();

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();
  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.snapshotBytes, "video-bytes");
  assert.equal(call.snapshotMode, 0o600);
  assert.equal(call.dirMode, 0o700);
  assert.notEqual(call.request.videoPath, join(ctx.stagingRoot, "clip.mp4"));
  assert.equal(call.request.account.id, ctx.account.id);
  assert.equal(call.request.tokens.accessToken, "access-1");
  assert.equal(call.request.caption, "New video");
  assert.deepEqual(call.request.platformOptions, { privacyLevel: "SELF_ONLY" });
  await assert.rejects(access(call.request.videoPath));
  assert.deepEqual(await snapshotDirs(ctx.stagingRoot), []);

  const stored = await ctx.post(scheduled.id);
  assert.equal(stored?.status, "published");
  assert.equal(stored?.externalPostId, "ext-1");
  assert.equal(stored?.publishedAt, new Date(START).toISOString());
  assert.equal(stored?.error, undefined);
  assert.ok(ctx.logs.every((line) => !line.includes("access-1") && !line.includes("refresh-1")));
});

test("a staged file overwritten after confirmation fails STAGED_VIDEO_CHANGED and is never published", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const scheduled = await ctx.schedule();
  // Same size as the confirmed bytes, so only the content hash can detect the change.
  await writeFile(join(ctx.stagingRoot, "clip.mp4"), "video-BYTES");

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 0);
  const stored = await ctx.post(scheduled.id);
  assert.equal(stored?.status, "failed");
  assert.deepEqual(stored?.error, {
    code: "STAGED_VIDEO_CHANGED",
    message: "The video file changed after confirmation; preview and confirm again.",
  });
  assert.deepEqual(await snapshotDirs(ctx.stagingRoot), []);
});

test("a scheduled post without a confirmed hash fails STAGED_VIDEO_CHANGED and is never published", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const scheduled = await ctx.schedule({ confirmedSha256: null });

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 0);
  const stored = await ctx.post(scheduled.id);
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.error?.code, "STAGED_VIDEO_CHANGED");
  assert.deepEqual(await snapshotDirs(ctx.stagingRoot), []);
});

test("leaves posts that are not due yet untouched", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const future = await ctx.schedule({ at: START + 1000 });

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 0);
  assert.equal((await ctx.post(future.id))?.status, "scheduled");
});

test("marks a post overdue by more than the grace period as missed and never publishes it", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const late = await ctx.schedule({ at: START - 5 * MINUTE - 1 });

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 0);
  const stored = await ctx.post(late.id);
  assert.equal(stored?.status, "missed");
  assert.equal(stored?.error?.code, "MISSED");
  assert.ok((stored?.error?.message ?? "").length > 0);
});

test("a post exactly at the grace boundary is still published (missed means strictly later)", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const boundary = await ctx.schedule({ at: START - 5 * MINUTE });

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 1);
  assert.equal((await ctx.post(boundary.id))?.status, "published");
});

test("honors a custom missedGraceMs", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const late = await ctx.schedule({ at: START - 2000 });

  await ctx.worker({ publishers: { tiktok: publisher }, missedGraceMs: 1000 }).tick();

  assert.equal(calls.length, 0);
  assert.equal((await ctx.post(late.id))?.status, "missed");
});

test("concurrent ticks publish a post exactly once", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const scheduled = await ctx.schedule();
  const first = ctx.worker({ publishers: { tiktok: publisher } });
  const second = ctx.worker({ publishers: { tiktok: publisher } });

  await Promise.all([first.tick(), second.tick(), first.tick()]);

  assert.equal(calls.length, 1);
  assert.equal((await ctx.post(scheduled.id))?.status, "published");
});

test("a SocialPublishError marks the post failed with its code and is not retried", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok", async () => {
    throw new SocialPublishError("AUTH_EXPIRED", "TikTok rejected the access token. Reconnect the account.");
  });
  const scheduled = await ctx.schedule();
  const worker = ctx.worker({ publishers: { tiktok: publisher } });

  await worker.tick();
  await worker.tick();

  assert.equal(calls.length, 1);
  const stored = await ctx.post(scheduled.id);
  assert.equal(stored?.status, "failed");
  assert.deepEqual(stored?.error, {
    code: "AUTH_EXPIRED",
    message: "TikTok rejected the access token. Reconnect the account.",
  });
  assert.deepEqual(await snapshotDirs(ctx.stagingRoot), []);
});

test("an unexpected error marks the post failed as PROVIDER_ERROR without leaking its message", async (t) => {
  const ctx = await setup(t);
  const { publisher } = fakePublisher("tiktok", async () => {
    throw new Error("fetch failed for https://api.example/?access_token=access-1");
  });
  const scheduled = await ctx.schedule();

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  const stored = await ctx.post(scheduled.id);
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.error?.code, "PROVIDER_ERROR");
  assert.ok(!stored?.error?.message.includes("access-1"));
  assert.ok(ctx.logs.every((line) => !line.includes("access-1")));
  assert.deepEqual(await snapshotDirs(ctx.stagingRoot), []);
});

test("persists refreshed tokens returned by the publisher", async (t) => {
  const ctx = await setup(t);
  const { publisher } = fakePublisher("tiktok", async () => ({
    externalPostId: "ext-2",
    refreshedTokens: { accessToken: "access-2", refreshToken: "refresh-2", expiresAt: "2026-10-22T12:00:00.000Z" },
  }));
  const scheduled = await ctx.schedule();

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal((await ctx.post(scheduled.id))?.status, "published");
  assert.deepEqual(await ctx.storage.getAccountTokens(ctx.account.id), {
    accessToken: "access-2",
    refreshToken: "refresh-2",
    expiresAt: "2026-10-22T12:00:00.000Z",
  });
});

test("a missing account marks the post failed ACCOUNT_NOT_CONNECTED", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const scheduled = await ctx.schedule();
  await ctx.storage.deleteAccount("user-1", "tiktok");

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 0);
  const stored = await ctx.post(scheduled.id);
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.error?.code, "ACCOUNT_NOT_CONNECTED");
});

test("a reconnected account with a different id is not used for a post confirmed on the old one", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const scheduled = await ctx.schedule({ accountId: "old-account-id" });

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 0);
  assert.equal((await ctx.post(scheduled.id))?.error?.code, "ACCOUNT_NOT_CONNECTED");
});

test("a platform without a configured publisher marks the post failed PLATFORM_UNAVAILABLE", async (t) => {
  const ctx = await setup(t);
  const scheduled = await ctx.schedule();

  await ctx.worker({ publishers: {} }).tick();

  const stored = await ctx.post(scheduled.id);
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.error?.code, "PLATFORM_UNAVAILABLE");
});

test("a missing staged video marks the post failed STAGED_VIDEO_INVALID", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const scheduled = await ctx.schedule({ stagingFile: "gone.mp4" });

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 0);
  assert.equal((await ctx.post(scheduled.id))?.error?.code, "STAGED_VIDEO_INVALID");
});

test("one failing post does not stop the next and posts across users are processed", async (t) => {
  const ctx = await setup(t);
  const other = await ctx.storage.upsertAccount(
    "user-2",
    "tiktok",
    { externalAccountId: "tt-2", displayName: "@other", scopes: ["video.publish"] },
    { accessToken: "access-other" },
  );
  let attempt = 0;
  const { publisher, calls } = fakePublisher("tiktok", async () => {
    attempt += 1;
    if (attempt === 1) throw new SocialPublishError("REJECTED", "Rejected by TikTok.");
    return { externalPostId: `ext-${attempt}` };
  });
  const first = await ctx.schedule({ at: START - 2000 });
  const second = await ctx.schedule({ at: START - 1000, userId: "user-2", accountId: other.id });

  await ctx.worker({ publishers: { tiktok: publisher } }).tick();

  assert.equal(calls.length, 2);
  assert.equal((await ctx.post(first.id))?.status, "failed");
  const published = await ctx.post(second.id, "user-2");
  assert.equal(published?.status, "published");
  assert.equal(published?.externalPostId, "ext-2");
});

test("tick never throws when storage fails", async (t) => {
  const ctx = await setup(t);
  await ctx.schedule();
  const broken: SocialStorage = {
    ...ctx.storage,
    transitionPost: async () => {
      throw new Error("database is locked");
    },
  };

  await ctx.worker({ storage: broken, publishers: { tiktok: fakePublisher("tiktok").publisher } }).tick();

  assert.ok(ctx.logs.length > 0);
});

test("recovery marks posts stuck in publishing as failed INTERRUPTED and never republishes them", async (t) => {
  const ctx = await setup(t);
  const { publisher, calls } = fakePublisher("tiktok");
  const stuck = await ctx.schedule();
  assert.equal(await ctx.storage.transitionPost(stuck.id, ["scheduled"], "publishing"), true);
  const untouched = await ctx.schedule({ at: START + MINUTE });
  const worker = ctx.worker({ publishers: { tiktok: publisher } });

  await worker.recover();
  await worker.tick();

  assert.equal(calls.length, 0);
  const stored = await ctx.post(stuck.id);
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.error?.code, "INTERRUPTED");
  assert.match(stored?.error?.message ?? "", /check/i);
  assert.equal((await ctx.post(untouched.id))?.status, "scheduled");
});

test("start recovers, ticks immediately and on the interval without overlapping; stop clears it", async (t) => {
  const ctx = await setup(t);
  const gate = deferred();
  const { publisher, calls } = fakePublisher("tiktok", async () => {
    await gate.promise;
    return { externalPostId: "ext-slow" };
  });
  const stuck = await ctx.schedule();
  assert.equal(await ctx.storage.transitionPost(stuck.id, ["scheduled"], "publishing"), true);
  const due = await ctx.schedule();

  // Every scan starts with a synchronous client.execute call, so the counter moves as soon as a tick begins.
  let scans = 0;
  const client: SocialWorkerDeps["client"] = {
    execute: (statement) => {
      scans += 1;
      return ctx.client.execute(statement);
    },
  };
  const intervals: Array<{ callback: () => void; ms: number; cleared: boolean }> = [];
  const timers: WorkerTimers = {
    setInterval(callback, ms) {
      const entry = { callback, ms, cleared: false };
      intervals.push(entry);
      return entry;
    },
    clearInterval(handle) {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  const worker = ctx.worker({ client, publishers: { tiktok: publisher }, timers });

  const started = worker.start({ intervalMs: 1234 });
  assert.equal(worker.start({ intervalMs: 1234 }), started, "start is idempotent while running");
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 1234);

  while (calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
  const scansWhileBlocked = scans;
  intervals[0].callback();
  intervals[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scans, scansWhileBlocked, "interval ticks are skipped while a tick is running");

  gate.resolve();
  await started;
  assert.equal(calls.length, 1);
  assert.equal((await ctx.post(stuck.id))?.error?.code, "INTERRUPTED");
  assert.equal((await ctx.post(due.id))?.status, "published");

  const later = await ctx.schedule({ at: START + 1000 });
  ctx.clock.now = START + 2000;
  intervals[0].callback();
  while ((await ctx.post(later.id))?.status !== "published") await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);

  worker.stop();
  assert.equal(intervals[0].cleared, true);
  const afterStop = await ctx.schedule({ at: START + 2000 });
  const scansBefore = scans;
  intervals[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scans, scansBefore, "a stopped worker ignores stray interval callbacks");
  assert.equal((await ctx.post(afterStop.id))?.status, "scheduled");
});
