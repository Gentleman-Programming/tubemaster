import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import type { SocialPostStatus } from "../../contracts";
import { createSocialStorage, initializeSocialTables } from "../../storage";
import { createSocialQueueService, type PreviewInput, type QueueErrorCode, type QueueResult } from "../service";

const SECRET = "test-nextauth-secret-value";
const START = Date.parse("2026-10-21T12:00:00.000Z");

async function setup(t: test.TestContext) {
  const stagingRoot = await mkdtemp(join(tmpdir(), "social-queue-"));
  t.after(() => rm(stagingRoot, { recursive: true, force: true }));
  await writeFile(join(stagingRoot, "clip.mp4"), "video-bytes");
  const clock = { now: START };
  const now = () => new Date(clock.now);
  const client = createClient({ url: ":memory:" });
  await initializeSocialTables(client);
  const storage = createSocialStorage({ client, secret: SECRET, now });
  await storage.upsertAccount(
    "user-1",
    "tiktok",
    { externalAccountId: "tt-1", displayName: "@gentleman", scopes: ["video.publish"] },
    { accessToken: "access" },
  );
  const service = createSocialQueueService({ storage, secret: SECRET, stagingRoot, now });
  return { stagingRoot, clock, storage, service };
}

function input(overrides: Partial<PreviewInput> = {}): PreviewInput {
  return {
    userId: "user-1",
    platform: "tiktok",
    stagingFile: "clip.mp4",
    caption: "New video",
    platformOptions: { privacyLevel: "SELF_ONLY", disableComment: true },
    schedule: { mode: "at", localDateTime: "2026-10-22T10:00:00", timezone: "America/Argentina/Buenos_Aires" },
    ...overrides,
  } as PreviewInput;
}

function value<T>(result: QueueResult<T>): T {
  if (!result.ok) assert.fail(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

function assertError(result: QueueResult<unknown>, code: QueueErrorCode) {
  assert.equal(result.ok, false, `expected ${code}`);
  if (!result.ok) {
    assert.equal(result.error.code, code);
    assert.ok(result.error.message.length > 0);
  }
}

async function statusOf(storage: Awaited<ReturnType<typeof setup>>["storage"], postId: string) {
  return (await storage.getPost("user-1", postId))?.status;
}

test("preview creates a draft bound to a confirmation token", async (t) => {
  const { service, storage } = await setup(t);
  const preview = value(await service.preview(input()));

  assert.equal(preview.post.status, "draft");
  assert.equal(preview.scheduledAtUtc, "2026-10-22T13:00:00.000Z");
  assert.equal(preview.post.timezone, "America/Argentina/Buenos_Aires");
  assert.deepEqual(preview.post.platformOptions, { privacyLevel: "SELF_ONLY", disableComment: true });
  assert.deepEqual(preview.account, { id: preview.post.accountId, platform: "tiktok", displayName: "@gentleman" });
  assert.deepEqual(preview.video, { stagingFile: "clip.mp4", size: "video-bytes".length });
  assert.match(preview.confirmationToken, /^\d+\.[a-f0-9]{64}$/);
  assert.equal(preview.confirmationExpiresAt, new Date(START + 600_000).toISOString());
  assert.equal(await statusOf(storage, preview.post.id), "draft");
});

test("preview with mode now schedules at the current time", async (t) => {
  const { service } = await setup(t);
  const preview = value(await service.preview(input({ schedule: { mode: "now" } })));
  assert.equal(preview.scheduledAtUtc, new Date(START).toISOString());
});

test("preview rejects invalid input without creating posts", async (t) => {
  const { service, storage, stagingRoot } = await setup(t);
  await writeFile(join(stagingRoot, "notes.txt"), "text");
  const cases: [Partial<PreviewInput> | Record<string, unknown>, QueueErrorCode][] = [
    [{ caption: "" }, "INVALID_INPUT"],
    [{ caption: "   " }, "INVALID_INPUT"],
    [{ caption: "x".repeat(2201) }, "INVALID_INPUT"],
    [{ platform: "x" }, "INVALID_INPUT"],
    [{ platformOptions: { disableComment: true } }, "INVALID_INPUT"],
    [{ platformOptions: { privacyLevel: "SELF_ONLY", extra: 1 } }, "INVALID_INPUT"],
    [{ platformOptions: { privacyLevel: "SELF_ONLY", disableDuet: "yes" } }, "INVALID_INPUT"],
    [{ platform: "instagram", platformOptions: { privacyLevel: "SELF_ONLY" } }, "INVALID_INPUT"],
    [{ platform: "instagram", platformOptions: { shareToFeed: true } }, "ACCOUNT_NOT_CONNECTED"],
    [{ userId: "user-2" }, "ACCOUNT_NOT_CONNECTED"],
    [{ schedule: { mode: "at", localDateTime: "2026-10-21T08:59:59", timezone: "America/Argentina/Buenos_Aires" } }, "INVALID_INPUT"],
    [{ schedule: { mode: "at", localDateTime: "2026-10-21T09:00:00", timezone: "America/Argentina/Buenos_Aires" } }, "INVALID_INPUT"],
    [{ schedule: { mode: "at", localDateTime: "2027-03-14T02:30:00", timezone: "America/New_York" } }, "INVALID_INPUT"],
    [{ schedule: { mode: "at", localDateTime: "2026-11-01T01:30:00", timezone: "America/New_York" } }, "INVALID_INPUT"],
    [{ schedule: { mode: "at", localDateTime: "2026-10-22T10:00", timezone: "UTC" } }, "INVALID_INPUT"],
    [{ schedule: { mode: "at", localDateTime: "2026-10-22T10:00:00", timezone: "Mars/Olympus" } }, "INVALID_INPUT"],
    [{ schedule: { mode: "now", timezone: "UTC" } as never }, "INVALID_INPUT"],
    [{ stagingFile: "missing.mp4" }, "STAGED_VIDEO_INVALID"],
    [{ stagingFile: "../clip.mp4" }, "STAGED_VIDEO_INVALID"],
    [{ stagingFile: "notes.txt" }, "STAGED_VIDEO_INVALID"],
  ];
  for (const [overrides, code] of cases) {
    assertError(await service.preview(input(overrides as Partial<PreviewInput>)), code);
  }
  assertError(await service.preview({ ...input(), extra: true } as PreviewInput), "INVALID_INPUT");
  assert.deepEqual(await storage.listPosts("user-1"), []);
});

test("confirm succeeds once and moves the draft to scheduled", async (t) => {
  const { service, storage } = await setup(t);
  const preview = value(await service.preview(input()));

  const confirmed = value(await service.confirm({ userId: "user-1", postId: preview.post.id, confirmationToken: preview.confirmationToken }));
  assert.equal(confirmed.status, "scheduled");
  assert.equal(await statusOf(storage, preview.post.id), "scheduled");

  assertError(await service.confirm({ userId: "user-1", postId: preview.post.id, confirmationToken: preview.confirmationToken }), "INVALID_STATE");
});

test("confirm rejects tampered, expired, stale-file and foreign attempts without changing status", async (t) => {
  const { service, storage, clock, stagingRoot } = await setup(t);
  const preview = value(await service.preview(input()));
  const postId = preview.post.id;
  const [expiry, signature] = preview.confirmationToken.split(".");
  const flipped = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;

  for (const token of [`${expiry}.${flipped}`, `${Number(expiry) + 1}.${signature}`, "garbage", "", `${expiry}.`]) {
    assertError(await service.confirm({ userId: "user-1", postId, confirmationToken: token }), "CONFIRMATION_INVALID");
  }
  assertError(await service.confirm({ userId: "user-2", postId, confirmationToken: preview.confirmationToken }), "NOT_FOUND");
  assert.equal(await statusOf(storage, postId), "draft");

  await writeFile(join(stagingRoot, "clip.mp4"), "different-bytes");
  assertError(await service.confirm({ userId: "user-1", postId, confirmationToken: preview.confirmationToken }), "CONFIRMATION_INVALID");
  await writeFile(join(stagingRoot, "clip.mp4"), "video-bytes");

  clock.now = START + 601_000;
  assertError(await service.confirm({ userId: "user-1", postId, confirmationToken: preview.confirmationToken }), "CONFIRMATION_EXPIRED");
  assert.equal(await statusOf(storage, postId), "draft");
});

test("confirm refuses posts more than five minutes overdue but allows the grace window", async (t) => {
  const { service, storage, clock } = await setup(t);
  const late = value(await service.preview(input({ schedule: { mode: "now" } })));
  const onTime = value(await service.preview(input({ schedule: { mode: "now" } })));

  clock.now = START + 5 * 60_000 + 1_000;
  assertError(await service.confirm({ userId: "user-1", postId: late.post.id, confirmationToken: late.confirmationToken }), "INVALID_STATE");
  assert.equal(await statusOf(storage, late.post.id), "draft");

  clock.now = START + 4 * 60_000;
  value(await service.confirm({ userId: "user-1", postId: onTime.post.id, confirmationToken: onTime.confirmationToken }));
  assert.equal(await statusOf(storage, onTime.post.id), "scheduled");
});

test("cancel is allowed from draft, scheduled and missed only", async (t) => {
  const { service, storage } = await setup(t);
  const ids: Record<string, string> = {};
  for (const status of ["draft", "scheduled", "missed", "publishing", "published", "failed", "cancelled"] as SocialPostStatus[]) {
    const preview = value(await service.preview(input()));
    ids[status] = preview.post.id;
    if (status !== "draft") assert.ok(await storage.transitionPost(preview.post.id, ["draft"], status));
  }

  for (const status of ["draft", "scheduled", "missed"]) {
    assert.equal(value(await service.cancel({ userId: "user-1", postId: ids[status] })).status, "cancelled");
  }
  for (const status of ["publishing", "published", "failed", "cancelled"] as SocialPostStatus[]) {
    assertError(await service.cancel({ userId: "user-1", postId: ids[status] }), "INVALID_STATE");
    assert.equal(await statusOf(storage, ids[status]), status);
  }
  assertError(await service.cancel({ userId: "user-2", postId: ids.draft }), "NOT_FOUND");
});

test("reschedule returns scheduled and missed posts to draft with a new token", async (t) => {
  const { service, storage } = await setup(t);
  const first = value(await service.preview(input()));
  value(await service.confirm({ userId: "user-1", postId: first.post.id, confirmationToken: first.confirmationToken }));
  const newSchedule = { mode: "at", localDateTime: "2026-10-23T18:30:00", timezone: "UTC" } as const;

  const rescheduled = value(await service.reschedule({ userId: "user-1", postId: first.post.id, schedule: newSchedule }));
  assert.equal(rescheduled.post.status, "draft");
  assert.equal(rescheduled.scheduledAtUtc, "2026-10-23T18:30:00.000Z");
  assert.equal(rescheduled.post.timezone, "UTC");
  assert.notEqual(rescheduled.confirmationToken, first.confirmationToken);
  assert.equal(await statusOf(storage, first.post.id), "draft");

  assertError(await service.confirm({ userId: "user-1", postId: first.post.id, confirmationToken: first.confirmationToken }), "CONFIRMATION_INVALID");
  value(await service.confirm({ userId: "user-1", postId: first.post.id, confirmationToken: rescheduled.confirmationToken }));
  assert.equal(await statusOf(storage, first.post.id), "scheduled");

  const missed = value(await service.preview(input()));
  assert.ok(await storage.transitionPost(missed.post.id, ["draft"], "missed", { error: { code: "MISSED", message: "late" } }));
  const fromMissed = value(await service.reschedule({ userId: "user-1", postId: missed.post.id, schedule: { mode: "now" } }));
  assert.equal(fromMissed.post.status, "draft");
  assert.equal(fromMissed.post.error, undefined);
});

test("reschedule rejects invalid states, times and foreign posts", async (t) => {
  const { service, storage } = await setup(t);
  const draft = value(await service.preview(input()));
  const schedule = { mode: "at", localDateTime: "2026-10-23T18:30:00", timezone: "UTC" } as const;

  assertError(await service.reschedule({ userId: "user-1", postId: draft.post.id, schedule }), "INVALID_STATE");
  assert.ok(await storage.transitionPost(draft.post.id, ["draft"], "scheduled"));
  assertError(await service.reschedule({ userId: "user-2", postId: draft.post.id, schedule }), "NOT_FOUND");
  assertError(
    await service.reschedule({ userId: "user-1", postId: draft.post.id, schedule: { mode: "at", localDateTime: "2026-10-20T10:00:00", timezone: "UTC" } }),
    "INVALID_INPUT",
  );
  assert.equal(await statusOf(storage, draft.post.id), "scheduled");
});

test("list and get are scoped by user and validate the status filter", async (t) => {
  const { service, storage } = await setup(t);
  await storage.upsertAccount("user-2", "tiktok", { externalAccountId: "tt-2", displayName: "@other", scopes: [] }, { accessToken: "a" });
  const mine = value(await service.preview(input()));
  const scheduled = value(await service.preview(input()));
  assert.ok(await storage.transitionPost(scheduled.post.id, ["draft"], "scheduled"));
  const theirs = value(await service.preview(input({ userId: "user-2" })));

  assert.deepEqual(value(await service.list({ userId: "user-1" })).map((post) => post.id).sort(), [mine.post.id, scheduled.post.id].sort());
  assert.deepEqual(value(await service.list({ userId: "user-1", status: "scheduled" })).map((post) => post.id), [scheduled.post.id]);
  assertError(await service.list({ userId: "user-1", status: "bogus" as SocialPostStatus }), "INVALID_INPUT");

  assert.equal(value(await service.get({ userId: "user-1", postId: mine.post.id })).id, mine.post.id);
  assertError(await service.get({ userId: "user-1", postId: theirs.post.id }), "NOT_FOUND");
});
