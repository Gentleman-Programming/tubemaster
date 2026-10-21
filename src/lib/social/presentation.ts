import type { JsonObject, SocialPlatform, SocialPostStatus } from "./contracts";

// Client-safe helpers for the social dashboard: imports types only, never server modules.

export const SOCIAL_CAPTION_MAX_LENGTH = 2200;

const PLATFORM_LABELS: Record<SocialPlatform, string> = { tiktok: "TikTok", instagram: "Instagram" };

export function platformLabel(platform: SocialPlatform): string {
  return PLATFORM_LABELS[platform];
}

export type PlatformChip = { label: string; dotClassName: string };

const PLATFORM_DOTS: Record<SocialPlatform, string> = { tiktok: "bg-sky", instagram: "bg-hot" };

/** Label and accent dot for a platform chip. */
export function platformChip(platform: SocialPlatform): PlatformChip {
  return { label: PLATFORM_LABELS[platform], dotClassName: PLATFORM_DOTS[platform] };
}

/** Same names as the UI Badge tones; kept here so this module stays free of component imports. */
export type PostStatusTone = "neutral" | "rose" | "sky" | "mint" | "peach" | "danger" | "warn";

/**
 * `tone` and `modifier` feed the Badge primitive; `className` is the self-contained token
 * styling for surfaces that do not use Badge (for example calendar chips).
 */
export type PostStatusBadge = { label: string; description: string; tone: PostStatusTone; modifier: string; className: string };

const BADGES: Record<SocialPostStatus, PostStatusBadge> = {
  draft: {
    label: "Draft",
    description: "Waiting for your confirmation. Nothing is posted until you confirm.",
    tone: "neutral",
    modifier: "",
    className: "border-line bg-glass-2 text-dim",
  },
  scheduled: {
    label: "Scheduled",
    description: "Confirmed. It is published at the scheduled time while the app is running.",
    tone: "sky",
    modifier: "",
    className: "border-sky/30 bg-sky/10 text-sky",
  },
  publishing: {
    label: "Publishing",
    description: "Uploading to the platform now.",
    tone: "rose",
    modifier: "animate-pulse",
    className: "border-rose/30 bg-rose/10 text-rose animate-pulse",
  },
  published: {
    label: "Published",
    description: "Posted to the platform.",
    tone: "mint",
    modifier: "",
    className: "border-mint/30 bg-mint/10 text-mint",
  },
  failed: {
    label: "Failed",
    description: "The platform did not accept the post. It is not retried automatically; check the platform before rescheduling.",
    tone: "danger",
    modifier: "",
    className: "border-danger/30 bg-danger/10 text-danger",
  },
  missed: {
    label: "Missed",
    description: "Not published: the app was not running at the scheduled time. Reschedule to publish.",
    tone: "peach",
    modifier: "",
    className: "border-peach/30 bg-peach/10 text-peach",
  },
  cancelled: {
    label: "Cancelled",
    description: "Cancelled. It will not be published.",
    tone: "neutral",
    modifier: "opacity-60",
    className: "border-line-soft bg-glass text-muted",
  },
};

export function postStatusBadge(status: SocialPostStatus): PostStatusBadge {
  return BADGES[status];
}

// Mirrors the queue service rules (S8); the server enforces them again.
const CANCELLABLE: readonly SocialPostStatus[] = ["draft", "scheduled", "failed", "missed"];
const RESCHEDULABLE: readonly SocialPostStatus[] = ["scheduled", "failed", "missed"];

export const canCancelPost = (status: SocialPostStatus) => CANCELLABLE.includes(status);
export const canReschedulePost = (status: SocialPostStatus) => RESCHEDULABLE.includes(status);

export function connectBannerMessage(platform: string | null | undefined): string | null {
  return platform === "tiktok" || platform === "instagram" ? `${platformLabel(platform)} account connected.` : null;
}

export function connectErrorMessage(code: string): string {
  switch (code) {
    case "access_denied":
      return "The connection was cancelled or permission was denied on the platform.";
    case "invalid_state":
      return "The connection request expired or did not match this session. Start the connection again from this page.";
    case "not_configured":
      return "This platform is not configured. Add its app credentials to .env.local and restart the app.";
    case "exchange_failed":
      return "The platform could not finish the connection. Check the app credentials and redirect URI, then try again.";
    case "storage_failed":
      return "The account was authorized but could not be saved. Try again.";
    case "no_instagram_business_account":
      return "No Instagram professional (Business or Creator) account linked to a Facebook Page was found.";
    default:
      return "The account could not be connected. Try again.";
  }
}

export type SocialFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type ApiError = { code: string | undefined; message: string | undefined };

/** Social API error bodies carry the code in `error`; `code` is accepted as a fallback. */
export function readApiError(body: unknown): ApiError {
  if (!body || typeof body !== "object") return { code: undefined, message: undefined };
  const record = body as Record<string, unknown>;
  const code = typeof record.error === "string" ? record.error : typeof record.code === "string" ? record.code : undefined;
  return { code, message: typeof record.message === "string" ? record.message : undefined };
}

export type SocialApiResult<T> = { ok: true; body: T } | { ok: false; code: string | undefined; message: string };

/** Calls a social API route and maps any failure, including unreadable bodies, to a user message. */
export async function callSocialApi<T>(fetcher: SocialFetcher, url: string, init?: RequestInit): Promise<SocialApiResult<T>> {
  try {
    const response = await fetcher(url, init);
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && body !== null) return { ok: true, body: body as T };
    const error = readApiError(body);
    const code = error.code ?? (response.status === 401 ? "UNAUTHORIZED" : undefined);
    return { ok: false, code, message: queueErrorMessage(code, error.message) };
  } catch {
    return { ok: false, code: undefined, message: queueErrorMessage(undefined) };
  }
}

export function queueErrorMessage(code: string | undefined, message?: string): string {
  switch (code) {
    case "UNAUTHORIZED":
    case "unauthorized":
      return "Session expired. Sign in again.";
    case "CONFIRMATION_EXPIRED":
      return "The confirmation expired. Preview the post again before confirming.";
    case "CONFIRMATION_INVALID":
      return "The post changed since the preview. Preview the post again before confirming.";
    case "ACCOUNT_NOT_CONNECTED":
      return "The account for this post is not connected. Connect it first.";
    case "STAGED_VIDEO_INVALID":
      return "The staged video is missing or invalid. Stage the video again.";
    case "NOT_FOUND":
      return "Post not found. Refresh the queue.";
    case "INVALID_INPUT":
      return message ? `Check the post: ${message}.` : "Check the post fields and try again.";
    case "INVALID_STATE":
      return message ? `${message}.` : "The post can no longer be changed. Refresh the queue.";
    default:
      return "The request could not be completed. Refresh and try again.";
  }
}

function validTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

function formatInZone(utcIso: string, timezone: string): string | null {
  const time = Date.parse(utcIso);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short", hourCycle: "h23" }).format(time);
}

export function formatScheduledLocal(utcIso: string, timezone: string): string {
  const zone = validTimezone(timezone);
  const formatted = formatInZone(utcIso, zone);
  return formatted ? `${formatted} (${zone})` : utcIso;
}

export function formatScheduledUtc(utcIso: string): string {
  const formatted = formatInZone(utcIso, "UTC");
  return formatted ? `${formatted} UTC` : utcIso;
}

/** Joins date and time inputs into the queue's `localDateTime` (seconds always 00). */
export function toLocalDateTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return `${date}T${time}:00`;
}

export const TIKTOK_PRIVACY_OPTIONS = [
  { value: "SELF_ONLY", label: "Only me" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
  { value: "FOLLOWER_OF_CREATOR", label: "Followers" },
  { value: "PUBLIC_TO_EVERYONE", label: "Everyone" },
] as const;

export const TIKTOK_UNAUDITED_NOTICE =
  "Until TikTok audits your developer app, posts can only be private (Only me, SELF_ONLY) and the TikTok account must be private. Other privacy levels are rejected at publish time.";

const onOff = (disabled: unknown) => (disabled === true ? "off" : "on");

export function describePlatformOptions(platform: SocialPlatform, options: JsonObject): string[] {
  if (platform === "instagram") return [`Share to feed: ${options.shareToFeed === false ? "no" : "yes"}`];
  const privacy = TIKTOK_PRIVACY_OPTIONS.find((option) => option.value === options.privacyLevel);
  return [
    `Privacy: ${privacy ? `${privacy.label} (${privacy.value})` : String(options.privacyLevel ?? "not set")}`,
    `Comments: ${onOff(options.disableComment)}`,
    `Duet: ${onOff(options.disableDuet)}`,
    `Stitch: ${onOff(options.disableStitch)}`,
  ];
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(2)} GB`;
}
