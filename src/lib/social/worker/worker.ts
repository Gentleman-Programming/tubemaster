import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, mkdtemp, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Client } from "@libsql/client";
import {
  SocialPublishError,
  type SocialPlatform,
  type SocialPost,
  type SocialPostError,
  type SocialPostStatus,
  type SocialPublishResult,
  type SocialPublisher,
} from "../contracts";
import { resolveStagedVideo, StagedVideoError, type StagedVideo } from "../queue/staged-video";
import type { SocialStorage } from "../storage";

export const DEFAULT_MISSED_GRACE_MS = 5 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 30_000;
const MAX_ERROR_MESSAGE_LENGTH = 500;

const MISSED_ERROR: SocialPostError = {
  code: "MISSED",
  message: "The scheduled time passed before the post could be published. Reschedule it to publish.",
};
const INTERRUPTED_ERROR: SocialPostError = {
  code: "INTERRUPTED",
  message:
    "Publishing was interrupted (the app stopped mid-upload). Check the platform to see whether the video was posted before rescheduling it.",
};
const STAGED_VIDEO_CHANGED_ERROR: SocialPostError = {
  code: "STAGED_VIDEO_CHANGED",
  message: "The video file changed after confirmation; preview and confirm again.",
};
const PROVIDER_ERROR: SocialPostError = {
  code: "PROVIDER_ERROR",
  message: "The platform request failed unexpectedly. Check the platform before rescheduling the post.",
};

type WorkerStorage = Pick<
  SocialStorage,
  "listPosts" | "getAccount" | "getAccountTokens" | "updateAccountTokens" | "transitionPost"
>;

export type WorkerTimers = {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export type SocialWorkerDeps = {
  /** Only used to find which users have posts in a status; rows are read through `storage`. */
  client: Pick<Client, "execute">;
  storage: WorkerStorage;
  publishers: Partial<Record<SocialPlatform, SocialPublisher>>;
  stagingRoot: string;
  now?: () => Date;
  /** Receives operational notices only: post ids, statuses and error codes, never tokens or provider payloads. */
  logger?: (message: string) => void;
  missedGraceMs?: number;
  timers?: WorkerTimers;
};

export type SocialWorker = {
  /** Processes due posts once. Never throws. */
  tick(): Promise<void>;
  /** Fails posts left in `publishing` by a previous process. Never throws. */
  recover(): Promise<void>;
  /** Runs recovery and a first tick, then ticks on the interval; resolves when the first tick ends. */
  start(options?: { intervalMs?: number }): Promise<void>;
  stop(): void;
};

/** Failure the worker detects itself, before or around the publisher call. */
class PostFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PostFailure";
  }
}

const realTimers: WorkerTimers = {
  setInterval(callback, ms) {
    const handle = setInterval(callback, ms);
    handle.unref?.();
    return handle;
  },
  clearInterval(handle) {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
};

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function toPostError(error: unknown): SocialPostError {
  if (error instanceof PostFailure) return { code: error.code, message: error.message };
  if (error instanceof SocialPublishError) {
    return { code: error.code, message: error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH) || PROVIDER_ERROR.message };
  }
  if (error instanceof StagedVideoError) {
    return { code: error.code, message: "The staged video is missing or invalid. Stage it again and reschedule the post." };
  }
  // Unknown errors may carry URLs or provider payloads with credentials, so their text is never stored.
  return PROVIDER_ERROR;
}

export function createSocialWorker(deps: SocialWorkerDeps): SocialWorker {
  const { client, storage, publishers, stagingRoot } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.logger ?? ((message: string) => process.stderr.write(`[social-worker] ${message}\n`));
  const missedGraceMs = deps.missedGraceMs ?? DEFAULT_MISSED_GRACE_MS;
  const timers = deps.timers ?? realTimers;

  /** Storage lists posts per user, so the worker finds the users first and reuses its row mapping. */
  async function listPostsWithStatus(status: SocialPostStatus): Promise<SocialPost[]> {
    const { rows } = await client.execute({
      sql: "SELECT DISTINCT user_id FROM social_posts WHERE status = ?",
      args: [status],
    });
    const posts: SocialPost[] = [];
    for (const row of rows) posts.push(...(await storage.listPosts(String(row.user_id), { statuses: [status] })));
    return posts.sort(
      (a, b) => Date.parse(a.scheduledAtUtc) - Date.parse(b.scheduledAtUtc) || a.id.localeCompare(b.id),
    );
  }

  /** Copies the validated staged file into a private directory so later staging changes cannot alter the upload. */
  async function createSnapshot(video: StagedVideo, stagingFile: string): Promise<{ dir: string; path: string }> {
    let dir: string | undefined;
    try {
      dir = await mkdtemp(join(stagingRoot, ".social-snapshot-"));
      // mkdtemp uses 0700; explicitly enforce it even under an unusual umask.
      await chmod(dir, 0o700);
      const path = join(dir, stagingFile);
      const source = await open(video.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let target;
      try {
        target = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      } catch (error) {
        await source.close();
        throw error;
      }
      // Streams own their descriptors; pipeline destroys both on failure.
      await pipeline(source.createReadStream({ autoClose: true }), target.createWriteStream({ autoClose: true }));
      await chmod(path, 0o600);
      if ((await stat(path)).size !== video.size) throw new StagedVideoError();
      return { dir, path };
    } catch {
      if (dir) await rm(dir, { recursive: true, force: true });
      throw new StagedVideoError();
    }
  }

  async function publishClaimed(post: SocialPost): Promise<{ result: SocialPublishResult; accountId: string }> {
    const publisher = publishers[post.platform];
    if (!publisher) {
      throw new PostFailure("PLATFORM_UNAVAILABLE", `Publishing to ${post.platform} is not configured in this app.`);
    }
    const notConnected = new PostFailure(
      "ACCOUNT_NOT_CONNECTED",
      `The ${post.platform} account for this post is no longer connected. Reconnect it and reschedule the post.`,
    );
    const account = await storage.getAccount(post.userId, post.platform);
    // The post was confirmed for one specific account; a different (reconnected) account is never substituted.
    if (!account || account.id !== post.accountId) throw notConnected;
    let tokens;
    try {
      tokens = await storage.getAccountTokens(account.id);
    } catch {
      throw notConnected; // Undecryptable tokens, e.g. after NEXTAUTH_SECRET changed.
    }
    if (!tokens) throw notConnected;

    const video = await resolveStagedVideo({ stagingRoot, stagingFile: post.stagingFile });
    const snapshot = await createSnapshot(video, post.stagingFile);
    try {
      // S4: the hashed snapshot is exactly what gets uploaded, so it must match the bytes the user confirmed.
      if (!post.confirmedSha256 || (await sha256File(snapshot.path)) !== post.confirmedSha256) {
        throw new PostFailure(STAGED_VIDEO_CHANGED_ERROR.code, STAGED_VIDEO_CHANGED_ERROR.message);
      }
      const result = await publisher.publish({
        account,
        tokens,
        videoPath: snapshot.path,
        caption: post.caption,
        platformOptions: post.platformOptions,
      });
      return { result, accountId: account.id };
    } finally {
      await rm(snapshot.dir, { recursive: true, force: true });
    }
  }

  async function processPost(post: SocialPost): Promise<void> {
    // Checked right before claiming, so a post that waited behind a long upload is never published late (S3).
    if (now().getTime() - Date.parse(post.scheduledAtUtc) > missedGraceMs) {
      if (await storage.transitionPost(post.id, ["scheduled"], "missed", { error: MISSED_ERROR })) {
        log(`post ${post.id} missed its scheduled time`);
      }
      return;
    }
    // Atomic claim: only one tick (or process) can move the post out of `scheduled`.
    if (!(await storage.transitionPost(post.id, ["scheduled"], "publishing", { error: null }))) return;

    let outcome: { result: SocialPublishResult; accountId: string };
    try {
      outcome = await publishClaimed(post);
    } catch (error) {
      const postError = toPostError(error);
      // No automatic retry (S8): the user decides whether to reschedule.
      await storage.transitionPost(post.id, ["publishing"], "failed", { error: postError });
      log(`post ${post.id} failed: ${postError.code}`);
      return;
    }

    const published = await storage.transitionPost(post.id, ["publishing"], "published", {
      externalPostId: outcome.result.externalPostId,
      publishedAt: now().toISOString(),
      error: null,
    });
    log(published ? `post ${post.id} published` : `post ${post.id} published but its status changed meanwhile`);
    if (outcome.result.refreshedTokens) {
      try {
        await storage.updateAccountTokens(outcome.accountId, outcome.result.refreshedTokens);
      } catch (error) {
        log(`post ${post.id}: could not persist refreshed tokens (${errorName(error)})`);
      }
    }
  }

  async function tick(): Promise<void> {
    let due: SocialPost[];
    try {
      const nowMs = now().getTime();
      due = (await listPostsWithStatus("scheduled")).filter((post) => Date.parse(post.scheduledAtUtc) <= nowMs);
    } catch (error) {
      log(`could not list scheduled posts (${errorName(error)})`);
      return;
    }
    // Sequential on purpose: one upload at a time, and one post's failure never stops the rest.
    for (const post of due) {
      try {
        await processPost(post);
      } catch (error) {
        log(`post ${post.id} could not be processed (${errorName(error)})`);
      }
    }
  }

  async function recover(): Promise<void> {
    let stuck: SocialPost[];
    try {
      stuck = await listPostsWithStatus("publishing");
    } catch (error) {
      log(`could not list interrupted posts (${errorName(error)})`);
      return;
    }
    // Never republished automatically: the upload may have reached the platform before the app stopped.
    for (const post of stuck) {
      try {
        if (await storage.transitionPost(post.id, ["publishing"], "failed", { error: INTERRUPTED_ERROR })) {
          log(`post ${post.id} was interrupted while publishing`);
        }
      } catch (error) {
        log(`post ${post.id} could not be recovered (${errorName(error)})`);
      }
    }
  }

  let running = false;
  let active = false;
  let handle: unknown;
  let started: Promise<void> | undefined;

  /** Skips the task while another one runs, so interval ticks never overlap. */
  async function runExclusive(task: () => Promise<void>): Promise<void> {
    if (running) return;
    running = true;
    try {
      await task();
    } finally {
      running = false;
    }
  }

  function start({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}): Promise<void> {
    if (started) return started;
    active = true;
    handle = timers.setInterval(() => {
      if (active) void runExclusive(tick);
    }, intervalMs);
    started = runExclusive(async () => {
      await recover();
      if (active) await tick();
    });
    return started;
  }

  function stop(): void {
    active = false;
    if (handle !== undefined) timers.clearInterval(handle);
    handle = undefined;
    started = undefined;
  }

  return { tick, recover, start, stop };
}
