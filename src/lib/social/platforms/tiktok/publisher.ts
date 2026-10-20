import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import {
  SocialPublishError,
  type SocialAccountTokens,
  type SocialOAuthConnector,
  type SocialPublishErrorCode,
  type SocialPublisher,
} from "../../contracts";
import { safeProviderCode } from "./connector";
import { TIKTOK_ENDPOINTS } from "./endpoints";

const MiB = 1024 * 1024;
const WHOLE_UPLOAD_LIMIT = 5 * MiB;
const DEFAULT_CHUNK_SIZE = 10 * MiB;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type TikTokChunkPlan = {
  videoSize: number;
  chunkSize: number;
  totalChunkCount: number;
  chunks: Array<{ start: number; end: number }>; // `end` is inclusive, as in Content-Range.
};

/**
 * TikTok FILE_UPLOAD rules: files under 5 MB (or smaller than one chunk) go as a single chunk of the
 * whole size; otherwise total = floor(size / chunk) and the last chunk absorbs the remainder.
 */
export function computeTikTokChunks(videoSize: number, chunkSize = DEFAULT_CHUNK_SIZE): TikTokChunkPlan {
  if (!Number.isInteger(videoSize) || videoSize <= 0) throw new Error("TikTok cannot upload an empty video");
  const size = videoSize < WHOLE_UPLOAD_LIMIT || videoSize < chunkSize ? videoSize : chunkSize;
  const totalChunkCount = Math.floor(videoSize / size);
  const chunks = Array.from({ length: totalChunkCount }, (_, index) => ({
    start: index * size,
    end: index === totalChunkCount - 1 ? videoSize - 1 : (index + 1) * size - 1,
  }));
  return { videoSize, chunkSize: size, totalChunkCount, chunks };
}

const CONTENT_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };

const AUTH_CODES = new Set(["access_token_invalid", "scope_not_authorized", "scope_permission_missed", "token_not_authorized"]);
const RATE_CODES = new Set(["rate_limit_exceeded", "spam_risk_too_many_posts", "spam_risk_too_many_pending_share"]);
const PROVIDER_CODES = new Set(["internal_error", "unknown_error"]);

function codeForTikTokError(code: string): SocialPublishErrorCode {
  if (AUTH_CODES.has(code)) return "AUTH_EXPIRED";
  if (RATE_CODES.has(code)) return "RATE_LIMITED";
  if (PROVIDER_CODES.has(code)) return "PROVIDER_ERROR";
  return "REJECTED";
}

type TikTokEnvelope<T> = { data?: T; error?: { code?: string } };

type CreatorInfo = {
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
};

type PublishStatus = {
  status?: string;
  fail_reason?: string;
  publicaly_available_post_id?: Array<string | number>; // Spelling as returned by TikTok.
  publicly_available_post_id?: Array<string | number>;
};

export type TikTokPublisherOptions = {
  connector: SocialOAuthConnector;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  /** Returns a stream of bytes [start, end] (inclusive) of the file. */
  readChunk?: (path: string, start: number, end: number) => ReadableStream<Uint8Array>;
};

function defaultReadChunk(path: string, start: number, end: number) {
  return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
}

export function createTikTokPublisher({
  connector,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  pollIntervalMs = 5000,
  pollTimeoutMs = 10 * 60 * 1000,
  readChunk = defaultReadChunk,
}: TikTokPublisherOptions): SocialPublisher {
  function httpFailure(status: number, step: string): SocialPublishError {
    if (status === 401) return new SocialPublishError("AUTH_EXPIRED", `TikTok ${step} was unauthorized; reconnect the account`);
    if (status === 429) return new SocialPublishError("RATE_LIMITED", `TikTok ${step} was rate limited`);
    return new SocialPublishError("PROVIDER_ERROR", `TikTok ${step} failed with HTTP ${status}`);
  }

  async function callApi<T>(url: string, accessToken: string, body: unknown, step: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new SocialPublishError("PROVIDER_ERROR", `TikTok ${step} request could not be sent`);
    }
    if (response.status === 401 || response.status === 429 || response.status >= 500) throw httpFailure(response.status, step);
    let envelope: TikTokEnvelope<T> | undefined;
    try {
      envelope = (await response.json()) as TikTokEnvelope<T>;
    } catch {
      envelope = undefined;
    }
    const code = envelope?.error?.code;
    if (code && code !== "ok") {
      const safeCode = safeProviderCode(code) ?? "unknown_error";
      throw new SocialPublishError(codeForTikTokError(safeCode), `TikTok ${step} failed: ${safeCode}`);
    }
    if (!response.ok) throw httpFailure(response.status, step);
    if (!envelope?.data) throw new SocialPublishError("PROVIDER_ERROR", `TikTok ${step} returned no data`);
    return envelope.data;
  }

  async function ensureFreshTokens(tokens: SocialAccountTokens) {
    const expiresAt = tokens.expiresAt ? Date.parse(tokens.expiresAt) : Number.NaN;
    if (Number.isNaN(expiresAt) || expiresAt - now() > REFRESH_MARGIN_MS) return undefined;
    try {
      return await connector.refreshTokens(tokens);
    } catch {
      throw new SocialPublishError("AUTH_EXPIRED", "TikTok token refresh failed; reconnect the account");
    }
  }

  async function uploadChunks(uploadUrl: string, videoPath: string, plan: TikTokChunkPlan) {
    const contentType = CONTENT_TYPES[extname(videoPath).toLowerCase()] ?? "video/mp4";
    for (const [index, { start, end }] of plan.chunks.entries()) {
      let response: Response;
      try {
        response = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(end - start + 1),
            "Content-Range": `bytes ${start}-${end}/${plan.videoSize}`,
          },
          body: readChunk(videoPath, start, end),
          duplex: "half",
        } as RequestInit & { duplex: "half" });
      } catch {
        throw new SocialPublishError("PROVIDER_ERROR", `TikTok upload of chunk ${index + 1} could not be sent`);
      }
      if (!response.ok) throw httpFailure(response.status, `upload of chunk ${index + 1}`);
    }
  }

  async function waitForPublish(publishId: string, accessToken: string): Promise<string> {
    const startedAt = now();
    while (now() - startedAt < pollTimeoutMs) {
      await sleep(pollIntervalMs);
      const result = await callApi<PublishStatus>(TIKTOK_ENDPOINTS.status, accessToken, { publish_id: publishId }, "status check");
      if (result.status === "PUBLISH_COMPLETE") {
        const [postId] = result.publicaly_available_post_id ?? result.publicly_available_post_id ?? [];
        return postId === undefined ? publishId : String(postId);
      }
      if (result.status === "FAILED") {
        const reason = safeProviderCode(result.fail_reason) ?? "unknown_reason";
        throw new SocialPublishError("REJECTED", `TikTok rejected the video: ${reason}`);
      }
    }
    throw new SocialPublishError("PROVIDER_ERROR", `TikTok publish ${publishId} timed out while processing`);
  }

  return {
    platform: "tiktok",

    async publish({ tokens, videoPath, caption, platformOptions }) {
      const refreshedTokens = await ensureFreshTokens(tokens);
      const accessToken = (refreshedTokens ?? tokens).accessToken;

      const creator = await callApi<CreatorInfo>(TIKTOK_ENDPOINTS.creatorInfo, accessToken, {}, "creator info");
      const allowed = creator.privacy_level_options ?? [];
      const privacyLevel = platformOptions.privacyLevel;
      if (typeof privacyLevel !== "string" || !allowed.includes(privacyLevel)) {
        const requested = typeof privacyLevel === "string" ? privacyLevel : "missing privacyLevel";
        throw new SocialPublishError(
          "REJECTED",
          `TikTok privacy level ${requested} is not allowed for this creator; allowed: ${allowed.join(", ") || "none"}`,
        );
      }

      let plan: TikTokChunkPlan;
      try {
        plan = computeTikTokChunks((await stat(videoPath)).size);
      } catch {
        throw new SocialPublishError("REJECTED", "The staged video is missing or empty");
      }

      const init = await callApi<{ publish_id?: string; upload_url?: string }>(TIKTOK_ENDPOINTS.videoInit, accessToken, {
        post_info: {
          title: caption,
          privacy_level: privacyLevel,
          disable_comment: platformOptions.disableComment === true || creator.comment_disabled === true,
          disable_duet: platformOptions.disableDuet === true || creator.duet_disabled === true,
          disable_stitch: platformOptions.disableStitch === true || creator.stitch_disabled === true,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: plan.videoSize,
          chunk_size: plan.chunkSize,
          total_chunk_count: plan.totalChunkCount,
        },
      }, "video init");
      if (!init.publish_id || !init.upload_url) {
        throw new SocialPublishError("PROVIDER_ERROR", "TikTok video init returned no upload target");
      }

      await uploadChunks(init.upload_url, videoPath, plan);
      const externalPostId = await waitForPublish(init.publish_id, accessToken);
      return refreshedTokens ? { externalPostId, refreshedTokens } : { externalPostId };
    },
  };
}
