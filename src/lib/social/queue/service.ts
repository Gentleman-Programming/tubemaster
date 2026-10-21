import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { toUnambiguousUtc } from "../../video-scheduling/schemas";
import {
  isSocialPostStatus,
  type JsonObject,
  type JsonValue,
  type SocialAccount,
  type SocialPlatform,
  type SocialPost,
  type SocialPostStatus,
} from "../contracts";
import type { SocialStorage } from "../storage";
import { resolveStagedVideo, type StagedVideo } from "./staged-video";

export type QueueErrorCode =
  | "INVALID_INPUT"
  | "ACCOUNT_NOT_CONNECTED"
  | "STAGED_VIDEO_INVALID"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "CONFIRMATION_INVALID"
  | "CONFIRMATION_EXPIRED";
export type QueueError = { code: QueueErrorCode; message: string };
export type QueueResult<T> = { ok: true; value: T } | { ok: false; error: QueueError };

const CONFIRMATION_TTL_SECONDS = 600;
/** S3: the worker marks a post missed after this delay, so an older time can no longer be confirmed. */
export const MISSED_GRACE_MS = 5 * 60_000;
// A failed post is never retried automatically (S8); the user may reschedule it with a new confirmation or cancel it.
const CANCELLABLE: SocialPostStatus[] = ["draft", "scheduled", "failed", "missed"];
const RESCHEDULABLE: SocialPostStatus[] = ["scheduled", "failed", "missed"];

const timezoneSchema = z.string().min(1).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
});

export const scheduleSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("now") }),
  z.strictObject({
    mode: z.literal("at"),
    localDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
    timezone: timezoneSchema,
  }),
]);
export type ScheduleInput = z.infer<typeof scheduleSchema>;

const tiktokOptionsSchema = z.strictObject({
  privacyLevel: z.string().trim().min(1).max(64),
  disableComment: z.boolean().optional(),
  disableDuet: z.boolean().optional(),
  disableStitch: z.boolean().optional(),
});
const instagramOptionsSchema = z.strictObject({ shareToFeed: z.boolean().optional() });

const previewFields = {
  stagingFile: z.string(),
  caption: z.string().max(2200).refine((value) => value.trim().length > 0, "Caption is required"),
  schedule: scheduleSchema,
};
const previewSchema = z.discriminatedUnion("platform", [
  z.strictObject({ platform: z.literal("tiktok"), platformOptions: tiktokOptionsSchema, ...previewFields }),
  z.strictObject({ platform: z.literal("instagram"), platformOptions: instagramOptionsSchema, ...previewFields }),
]);

/** Shape accepted from HTTP bodies; the service performs the detailed validation. */
export const previewBodySchema = z.strictObject({
  platform: z.string(),
  stagingFile: z.string(),
  caption: z.string(),
  platformOptions: z.record(z.string(), z.unknown()),
  schedule: scheduleSchema,
});

export type PreviewInput = {
  userId: string;
  platform: SocialPlatform;
  stagingFile: string;
  caption: string;
  platformOptions: JsonObject;
  schedule: ScheduleInput;
};

export type PostPreview = {
  post: SocialPost;
  scheduledAtUtc: string;
  account: { id: string; platform: SocialPlatform; displayName: string };
  video: { stagingFile: string; size: number };
  confirmationToken: string;
  confirmationExpiresAt: string;
};

export type SocialQueueDeps = {
  storage: Pick<SocialStorage, "getAccount" | "insertPost" | "getPost" | "listPosts" | "transitionPost">;
  secret: string; // NEXTAUTH_SECRET in production.
  stagingRoot: string;
  now?: () => Date;
};

const fail = (code: QueueErrorCode, message: string): { ok: false; error: QueueError } => ({ ok: false, error: { code, message } });
const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });
const isUserId = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Key-sorted serialization so the signed binding does not depend on JSON key order. */
function canonical(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function createSocialQueueService(deps: SocialQueueDeps) {
  const { storage } = deps;
  const now = deps.now ?? (() => new Date());

  function resolveSchedule(schedule: ScheduleInput): QueueResult<{ scheduledAtUtc: string; timezone: string }> {
    const current = now().getTime();
    if (schedule.mode === "now") return ok({ scheduledAtUtc: new Date(current).toISOString(), timezone: "UTC" });
    const scheduledAtUtc = toUnambiguousUtc(schedule.localDateTime, schedule.timezone);
    if (!scheduledAtUtc) return fail("INVALID_INPUT", "The local time does not exist or is ambiguous in that timezone");
    if (Date.parse(scheduledAtUtc) <= current) return fail("INVALID_INPUT", "The scheduled time must be in the future");
    return ok({ scheduledAtUtc, timezone: schedule.timezone });
  }

  async function stagedVideo(stagingFile: string): Promise<StagedVideo | null> {
    try {
      return await resolveStagedVideo({ stagingRoot: deps.stagingRoot, stagingFile });
    } catch {
      return null;
    }
  }

  // The token binds every field the user reviewed plus the exact file bytes (sha256).
  function sign(expiry: number, post: SocialPost, sha256: string): Buffer {
    const binding = JSON.stringify([
      post.userId, post.id, post.platform, post.accountId, post.stagingFile, sha256,
      post.caption, canonical(post.platformOptions), post.scheduledAtUtc,
    ]);
    return createHmac("sha256", deps.secret).update(`${expiry}:${binding}`).digest();
  }

  function buildPreview(post: SocialPost, account: SocialAccount, video: StagedVideo): PostPreview {
    const expiry = Math.floor(now().getTime() / 1000) + CONFIRMATION_TTL_SECONDS;
    return {
      post,
      scheduledAtUtc: post.scheduledAtUtc,
      account: { id: account.id, platform: account.platform, displayName: account.displayName },
      video: { stagingFile: post.stagingFile, size: video.size },
      confirmationToken: `${expiry}.${sign(expiry, post, video.sha256).toString("hex")}`,
      confirmationExpiresAt: new Date(expiry * 1000).toISOString(),
    };
  }

  async function connectedAccount(userId: string, platform: SocialPlatform, accountId?: string) {
    const account = await storage.getAccount(userId, platform);
    return account && (accountId === undefined || account.id === accountId) ? account : null;
  }

  async function preview(input: PreviewInput): Promise<QueueResult<PostPreview>> {
    if (!deps.secret) throw new Error("Social queue confirmation secret is not configured");
    const { userId, ...fields } = (input ?? {}) as PreviewInput;
    if (!isUserId(userId)) return fail("INVALID_INPUT", "A user is required");
    const parsed = previewSchema.safeParse(fields);
    if (!parsed.success) return fail("INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid post");
    const request = parsed.data;
    const schedule = resolveSchedule(request.schedule);
    if (!schedule.ok) return schedule;
    const account = await connectedAccount(userId, request.platform);
    if (!account) return fail("ACCOUNT_NOT_CONNECTED", `Connect a ${request.platform} account first`);
    const video = await stagedVideo(request.stagingFile);
    if (!video) return fail("STAGED_VIDEO_INVALID", "The staged video is missing or invalid");

    const post = await storage.insertPost({
      userId, accountId: account.id, platform: request.platform, stagingFile: request.stagingFile,
      caption: request.caption, platformOptions: request.platformOptions as JsonObject,
      scheduledAtUtc: schedule.value.scheduledAtUtc, timezone: schedule.value.timezone, status: "draft",
    });
    return ok(buildPreview(post, account, video));
  }

  async function confirm(input: { userId: string; postId: string; confirmationToken: string }): Promise<QueueResult<SocialPost>> {
    if (!deps.secret) throw new Error("Social queue confirmation secret is not configured");
    const post = await ownedPost(input.userId, input.postId);
    if (!post) return fail("NOT_FOUND", "Post not found");
    if (post.status !== "draft") return fail("INVALID_STATE", `A ${post.status} post cannot be confirmed`);

    const match = /^(\d{1,12})\.([a-f0-9]{64})$/.exec(typeof input.confirmationToken === "string" ? input.confirmationToken : "");
    if (!match) return fail("CONFIRMATION_INVALID", "Invalid confirmation token");
    const expiry = Number(match[1]);
    const nowSeconds = Math.floor(now().getTime() / 1000);
    if (expiry > nowSeconds + CONFIRMATION_TTL_SECONDS) return fail("CONFIRMATION_INVALID", "Invalid confirmation token");
    const account = await connectedAccount(post.userId, post.platform, post.accountId);
    if (!account) return fail("ACCOUNT_NOT_CONNECTED", `The ${post.platform} account for this post is no longer connected`);
    const video = await stagedVideo(post.stagingFile);
    if (!video) return fail("STAGED_VIDEO_INVALID", "The staged video is missing or invalid");
    // Recomputed from stored state and the current file: any change since the preview invalidates the token.
    if (!timingSafeEqual(Buffer.from(match[2], "hex"), sign(expiry, post, video.sha256))) {
      return fail("CONFIRMATION_INVALID", "The confirmation does not match this post; preview it again");
    }
    if (expiry < nowSeconds) return fail("CONFIRMATION_EXPIRED", "The confirmation expired; preview the post again");
    if (Date.parse(post.scheduledAtUtc) < now().getTime() - MISSED_GRACE_MS) {
      return fail("INVALID_STATE", "The scheduled time passed more than 5 minutes ago; reschedule the post");
    }
    // The verified hash is stored with the transition so the worker uploads only these confirmed bytes.
    if (!(await storage.transitionPost(post.id, ["draft"], "scheduled", { confirmedSha256: video.sha256 }))) {
      return fail("INVALID_STATE", "The post changed while confirming; reload it");
    }
    return found(post.userId, post.id);
  }

  /** A new time always needs a new confirmation (S4), so the post returns to draft. */
  async function reschedule(input: { userId: string; postId: string; schedule: ScheduleInput }): Promise<QueueResult<PostPreview>> {
    if (!deps.secret) throw new Error("Social queue confirmation secret is not configured");
    const post = await ownedPost(input.userId, input.postId);
    if (!post) return fail("NOT_FOUND", "Post not found");
    if (!RESCHEDULABLE.includes(post.status)) return fail("INVALID_STATE", `A ${post.status} post cannot be rescheduled`);
    const parsed = scheduleSchema.safeParse(input.schedule);
    if (!parsed.success) return fail("INVALID_INPUT", "Invalid schedule");
    const schedule = resolveSchedule(parsed.data);
    if (!schedule.ok) return schedule;
    const account = await connectedAccount(post.userId, post.platform, post.accountId);
    if (!account) return fail("ACCOUNT_NOT_CONNECTED", `The ${post.platform} account for this post is no longer connected`);
    const video = await stagedVideo(post.stagingFile);
    if (!video) return fail("STAGED_VIDEO_INVALID", "The staged video is missing or invalid");

    const moved = await storage.transitionPost(post.id, RESCHEDULABLE, "draft", {
      ...schedule.value,
      error: null,
      confirmedSha256: null,
    });
    if (!moved) return fail("INVALID_STATE", "The post changed while rescheduling; reload it");
    const updated = await storage.getPost(post.userId, post.id);
    if (!updated) return fail("NOT_FOUND", "Post not found");
    return ok(buildPreview(updated, account, video));
  }

  async function cancel(input: { userId: string; postId: string }): Promise<QueueResult<SocialPost>> {
    const post = await ownedPost(input.userId, input.postId);
    if (!post) return fail("NOT_FOUND", "Post not found");
    if (!CANCELLABLE.includes(post.status) || !(await storage.transitionPost(post.id, CANCELLABLE, "cancelled"))) {
      return fail("INVALID_STATE", `A ${post.status} post cannot be cancelled`);
    }
    return found(post.userId, post.id);
  }

  async function list(input: { userId: string; status?: SocialPostStatus }): Promise<QueueResult<SocialPost[]>> {
    if (!isUserId(input.userId)) return fail("INVALID_INPUT", "A user is required");
    if (input.status !== undefined && !isSocialPostStatus(input.status)) return fail("INVALID_INPUT", "Unknown post status");
    return ok(await storage.listPosts(input.userId, input.status ? { statuses: [input.status] } : {}));
  }

  async function get(input: { userId: string; postId: string }): Promise<QueueResult<SocialPost>> {
    return found(input.userId, input.postId);
  }

  async function ownedPost(userId: string, postId: string): Promise<SocialPost | null> {
    if (!isUserId(userId) || typeof postId !== "string" || postId.length === 0) return null;
    return storage.getPost(userId, postId);
  }

  async function found(userId: string, postId: string): Promise<QueueResult<SocialPost>> {
    const post = await ownedPost(userId, postId);
    return post ? ok(post) : fail("NOT_FOUND", "Post not found");
  }

  return { preview, confirm, reschedule, cancel, list, get };
}

export type SocialQueueService = ReturnType<typeof createSocialQueueService>;
