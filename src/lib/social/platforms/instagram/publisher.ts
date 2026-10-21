import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  SocialPublishError,
  type SocialAccountTokens,
  type SocialOAuthConnector,
  type SocialPublisher,
} from "../../contracts";
import { describeGraphError, graphErrorCode, readJson, type GraphError } from "./connector";
import { INSTAGRAM_ENDPOINTS } from "./endpoints";

// Long-lived tokens last about 60 days; re-exchange them a week ahead.
const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_CODES = new Set([190]);
const RATE_CODES = new Set([4, 17, 32, 613]);

type ContainerStatus = { status_code?: string; status?: string };

/** Container status descriptions are kept only when they look like plain provider text. */
function safeStatusText(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9 _.,:()-]{1,200}$/.test(value) ? value : undefined;
}

export type InstagramPublisherOptions = {
  connector: SocialOAuthConnector;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  readFile?: (path: string) => ReadableStream<Uint8Array>;
};

function defaultReadFile(path: string) {
  return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
}

export function createInstagramPublisher({
  connector,
  fetch = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  pollIntervalMs = 5000,
  pollTimeoutMs = 10 * 60 * 1000,
  readFile = defaultReadFile,
}: InstagramPublisherOptions): SocialPublisher {
  async function send(url: string, init: RequestInit, step: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      throw new SocialPublishError("PROVIDER_ERROR", `Instagram ${step} request could not be sent`);
    }
    const body = ((await readJson(response)) ?? {}) as { error?: GraphError } & Record<string, unknown>;
    const code = graphErrorCode(body.error);
    const detail = body.error ? `: ${describeGraphError(body.error)}` : "";
    if (response.status === 401 || (code !== undefined && AUTH_CODES.has(code))) {
      throw new SocialPublishError("AUTH_EXPIRED", `Instagram ${step} was unauthorized${detail}; reconnect the account`);
    }
    if (response.status === 429 || (code !== undefined && RATE_CODES.has(code))) {
      throw new SocialPublishError("RATE_LIMITED", `Instagram ${step} was rate limited${detail}`);
    }
    if (!response.ok || body.error) {
      throw new SocialPublishError("PROVIDER_ERROR", `Instagram ${step} failed with HTTP ${response.status}${detail}`);
    }
    return body;
  }

  function graphPost(url: string, accessToken: string, params: Record<string, string>, step: string) {
    return send(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    }, step);
  }

  async function ensureFreshTokens(tokens: SocialAccountTokens) {
    const expiresAt = tokens.expiresAt ? Date.parse(tokens.expiresAt) : Number.NaN;
    if (Number.isNaN(expiresAt) || expiresAt - now() > REFRESH_MARGIN_MS) return undefined;
    try {
      return await connector.refreshTokens(tokens);
    } catch {
      throw new SocialPublishError("AUTH_EXPIRED", "Instagram token refresh failed; reconnect the account");
    }
  }

  async function waitForContainer(containerId: string, accessToken: string) {
    const startedAt = now();
    while (now() - startedAt < pollTimeoutMs) {
      await sleep(pollIntervalMs);
      const result = (await send(INSTAGRAM_ENDPOINTS.containerStatus(containerId), {
        headers: { Authorization: `Bearer ${accessToken}` },
      }, "status check")) as ContainerStatus;
      if (result.status_code === "FINISHED") return;
      if (result.status_code === "ERROR" || result.status_code === "EXPIRED") {
        const status = safeStatusText(result.status);
        throw new SocialPublishError("REJECTED", `Instagram rejected the video (${result.status_code})${status ? `: ${status}` : ""}`);
      }
    }
    throw new SocialPublishError("PROVIDER_ERROR", `Instagram container ${containerId} timed out while processing`);
  }

  return {
    platform: "instagram",

    async publish({ account, tokens, videoPath, caption, platformOptions }) {
      const refreshedTokens = await ensureFreshTokens(tokens);
      const accessToken = (refreshedTokens ?? tokens).accessToken;
      const igUserId = account.externalAccountId;

      let size: number;
      try {
        size = (await stat(videoPath)).size;
      } catch {
        size = 0;
      }
      if (size <= 0) throw new SocialPublishError("REJECTED", "The staged video is missing or empty");

      const container = await graphPost(INSTAGRAM_ENDPOINTS.media(igUserId), accessToken, {
        media_type: "REELS",
        upload_type: "resumable",
        caption,
        share_to_feed: String(platformOptions.shareToFeed !== false),
      }, "container creation");
      const containerId = container.id;
      if (typeof containerId !== "string" || !containerId) {
        throw new SocialPublishError("PROVIDER_ERROR", "Instagram container creation returned no container id");
      }

      // The upload host is fixed rather than taken from the returned `uri`, so the token only goes to Meta's rupload.
      await send(INSTAGRAM_ENDPOINTS.upload(containerId), {
        method: "POST",
        headers: { Authorization: `OAuth ${accessToken}`, offset: "0", file_size: String(size) },
        body: readFile(videoPath),
        duplex: "half",
      } as RequestInit & { duplex: "half" }, "video upload");

      await waitForContainer(containerId, accessToken);

      const published = await graphPost(INSTAGRAM_ENDPOINTS.mediaPublish(igUserId), accessToken, { creation_id: containerId }, "media publish");
      if (typeof published.id !== "string" || !published.id) {
        throw new SocialPublishError("PROVIDER_ERROR", "Instagram media publish returned no media id");
      }
      return refreshedTokens ? { externalPostId: published.id, refreshedTokens } : { externalPostId: published.id };
    },
  };
}
