import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SocialPlatform } from "./contracts";

/** Short-lived, signed OAuth state shared by every social platform's connect/callback routes. */
export const SOCIAL_OAUTH_STATE_TTL_SECONDS = 600;
const COOKIE_PATH = "/api/social";

export type SocialOAuthEnv = {
  SOCIAL_OAUTH_BASE_URL?: string;
  NEXTAUTH_URL?: string;
  TIKTOK_REDIRECT_URI?: string;
  INSTAGRAM_REDIRECT_URI?: string;
};

type StatePayload = {
  platform: SocialPlatform;
  state: string;
  codeVerifier: string;
  userId: string;
  exp: number; // Epoch milliseconds.
};

function requireSecret(secret: string) {
  if (!secret) throw new Error("A non-empty secret is required to sign social OAuth state");
}

function signature(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

/** Constant-time comparison that also tolerates different lengths. */
function safeEqual(a: string, b: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b)) && a.length === b.length;
}

export function createSocialOAuthState(args: {
  platform: SocialPlatform;
  state: string;
  codeVerifier: string;
  userId: string;
  secret: string;
  now?: Date;
}): string {
  requireSecret(args.secret);
  const payload: StatePayload = {
    platform: args.platform,
    state: args.state,
    codeVerifier: args.codeVerifier,
    userId: args.userId,
    exp: (args.now ?? new Date()).getTime() + SOCIAL_OAUTH_STATE_TTL_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, args.secret)}`;
}

/** Returns the code verifier when the cookie value is authentic, unexpired and bound to the request; otherwise null. */
export function verifySocialOAuthState(
  value: string | undefined,
  expected: { platform: SocialPlatform; state: string; userId: string; secret: string; now?: Date },
): { codeVerifier: string } | null {
  if (!value || !expected.secret || !expected.state) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [encoded, providedSignature] = parts;
  if (!safeEqual(providedSignature, signature(encoded, expected.secret))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const { platform, state, codeVerifier, userId, exp } = payload as Partial<StatePayload>;
  if (typeof state !== "string" || typeof codeVerifier !== "string" || typeof userId !== "string" || typeof exp !== "number") {
    return null;
  }
  if (exp <= (expected.now ?? new Date()).getTime()) return null;
  if (platform !== expected.platform) return null;
  if (!safeEqual(userId, expected.userId) || !safeEqual(state, expected.state)) return null;
  return { codeVerifier };
}

export function socialOAuthCookieName(platform: SocialPlatform) {
  return `social_oauth_${platform}`;
}

export function socialOAuthBaseUrl(env: SocialOAuthEnv = process.env) {
  const base = env.SOCIAL_OAUTH_BASE_URL || env.NEXTAUTH_URL;
  if (!base) {
    throw new Error("Set SOCIAL_OAUTH_BASE_URL or NEXTAUTH_URL to build social OAuth redirect URIs");
  }
  return base.replace(/\/+$/, "");
}

/**
 * SOCIAL_OAUTH_BASE_URL may point at an HTTPS tunnel when a provider rejects localhost redirects.
 * A per-platform override (e.g. TIKTOK_REDIRECT_URI) registers a public page that forwards the
 * browser back to the local callback, for providers that reject every localhost redirect.
 */
export function socialRedirectUri(platform: SocialPlatform, env: SocialOAuthEnv = process.env) {
  const overrideKey = platform === "tiktok" ? "TIKTOK_REDIRECT_URI" : "INSTAGRAM_REDIRECT_URI";
  const override = env[overrideKey]?.trim();
  if (override) {
    if (!/^https:\/\/[^\s/]+\/\S*$/.test(override)) {
      throw new Error(`${overrideKey} must be an absolute https:// URL`);
    }
    return override;
  }
  return `${socialOAuthBaseUrl(env)}/api/social/${platform}/callback`;
}

export function socialOAuthCookieOptions(env: SocialOAuthEnv = process.env) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: COOKIE_PATH,
    secure: socialOAuthBaseUrl(env).startsWith("https://"),
    maxAge: SOCIAL_OAUTH_STATE_TTL_SECONDS,
  };
}

function serializeCookie(name: string, value: string, maxAge: number, env: SocialOAuthEnv) {
  const options = socialOAuthCookieOptions(env);
  const attributes = [`${name}=${value}`, `Path=${options.path}`, `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax"];
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

/** `Set-Cookie` header value carrying the signed state. */
export function serializeSocialOAuthCookie(platform: SocialPlatform, value: string, env: SocialOAuthEnv = process.env) {
  return serializeCookie(socialOAuthCookieName(platform), value, SOCIAL_OAUTH_STATE_TTL_SECONDS, env);
}

export function clearSocialOAuthCookie(platform: SocialPlatform, env: SocialOAuthEnv = process.env) {
  return serializeCookie(socialOAuthCookieName(platform), "", 0, env);
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}
