export const SOCIAL_PLATFORMS = ["instagram", "tiktok"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_POST_STATUSES = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "missed",
  "cancelled",
] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Public account shape. Raw tokens never leave storage through this type. */
export type SocialAccount = {
  id: string;
  userId: string;
  platform: SocialPlatform;
  externalAccountId: string;
  displayName: string;
  scopes: string[];
  tokenExpiresAt: string | null; // UTC ISO timestamp of the access token expiry, when known.
  connectedAt: string; // UTC ISO timestamp.
};

export type SocialAccountProfile = Pick<SocialAccount, "externalAccountId" | "displayName" | "scopes">;

export type SocialAccountTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // UTC ISO timestamp.
};

export type SocialPostError = { code: string; message: string };

export type SocialPost = {
  id: string;
  userId: string;
  accountId: string;
  platform: SocialPlatform;
  stagingFile: string;
  caption: string;
  platformOptions: JsonObject; // Platform-specific settings, e.g. TikTok privacy level.
  scheduledAtUtc: string;
  timezone: string; // IANA timezone the user scheduled in.
  status: SocialPostStatus;
  externalPostId?: string;
  error?: SocialPostError;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

export type NewSocialPost = Omit<
  SocialPost,
  "id" | "createdAt" | "updatedAt" | "externalPostId" | "error" | "publishedAt"
>;

export type SocialPostFilter = {
  statuses?: SocialPostStatus[];
  platform?: SocialPlatform;
  accountId?: string;
};

/** Fields a status transition may set alongside the new status. `null` clears a field. */
export type SocialPostTransitionPatch = {
  externalPostId?: string | null;
  error?: SocialPostError | null;
  publishedAt?: string | null;
  scheduledAtUtc?: string;
  timezone?: string;
};

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(value);
}

export function isSocialPostStatus(value: unknown): value is SocialPostStatus {
  return typeof value === "string" && (SOCIAL_POST_STATUSES as readonly string[]).includes(value);
}

/** Provider failure categories; the worker maps them to a `failed` post without retrying. */
export type SocialPublishErrorCode = "AUTH_EXPIRED" | "RATE_LIMITED" | "REJECTED" | "PROVIDER_ERROR";

export class SocialPublishError extends Error {
  readonly code: SocialPublishErrorCode;
  constructor(code: SocialPublishErrorCode, message: string) {
    super(message);
    this.name = "SocialPublishError";
    this.code = code;
  }
}

export type SocialPublishRequest = {
  account: SocialAccount;
  tokens: SocialAccountTokens;
  /** Absolute path of a validated, read-only snapshot of the staged video. */
  videoPath: string;
  caption: string;
  platformOptions: JsonObject;
};

export type SocialPublishResult = {
  externalPostId: string;
  /** Present when the publisher refreshed the tokens and the caller must persist them. */
  refreshedTokens?: SocialAccountTokens;
};

export interface SocialPublisher {
  readonly platform: SocialPlatform;
  publish(request: SocialPublishRequest): Promise<SocialPublishResult>;
}

export interface SocialOAuthConnector {
  readonly platform: SocialPlatform;
  authorizationUrl(args: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(args: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ profile: SocialAccountProfile; tokens: SocialAccountTokens }>;
  refreshTokens(tokens: SocialAccountTokens): Promise<SocialAccountTokens>;
}
