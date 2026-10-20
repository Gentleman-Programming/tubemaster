import type { SocialAccountProfile, SocialAccountTokens, SocialOAuthConnector } from "../../contracts";
import { INSTAGRAM_ENDPOINTS, INSTAGRAM_SCOPES } from "./endpoints";

export type InstagramConnectorOptions = {
  appId: string;
  appSecret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
};

/** Graph API error envelope. `message` may echo request data, so it is never surfaced. */
export type GraphError = { type?: unknown; code?: unknown; error_subcode?: unknown };

type TokenResponse = { access_token?: string; expires_in?: number; error?: GraphError };

type PagesResponse = {
  data?: Array<{ instagram_business_account?: { id?: string; username?: string } }>;
  error?: GraphError;
};

/** Thrown when none of the user's Pages has a linked Instagram professional account. */
export class InstagramNoBusinessAccountError extends Error {
  constructor() {
    super("No Instagram professional (Business or Creator) account is linked to a Facebook Page you manage");
    this.name = "InstagramNoBusinessAccountError";
  }
}

export function graphErrorCode(error: GraphError | undefined): number | undefined {
  return typeof error?.code === "number" && Number.isInteger(error.code) ? error.code : undefined;
}

/** Only the error type and numeric code are surfaced, e.g. "OAuthException code 190". */
export function describeGraphError(error: GraphError | undefined): string {
  const type = typeof error?.type === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(error.type) ? error.type : "GraphError";
  const code = graphErrorCode(error);
  return code === undefined ? type : `${type} code ${code}`;
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createInstagramConnector({
  appId,
  appSecret,
  fetch = globalThis.fetch,
  now = () => new Date(),
}: InstagramConnectorOptions): SocialOAuthConnector {
  // Meta documents GET with query parameters for this endpoint; the URL is never logged or surfaced.
  async function tokenRequest(params: Record<string, string>): Promise<SocialAccountTokens> {
    const url = new URL(INSTAGRAM_ENDPOINTS.token);
    url.search = new URLSearchParams(params).toString();
    const response = await fetch(url.toString());
    const body = ((await readJson(response)) ?? {}) as TokenResponse;
    if (!response.ok || body.error || !body.access_token) {
      throw new Error(`Instagram token request failed (HTTP ${response.status}): ${describeGraphError(body.error)}`);
    }
    const tokens: SocialAccountTokens = { accessToken: body.access_token };
    if (typeof body.expires_in === "number") {
      tokens.expiresAt = new Date(now().getTime() + body.expires_in * 1000).toISOString();
    }
    return tokens;
  }

  // Long-lived user tokens have no refresh token; they are re-exchanged with fb_exchange_token instead.
  function exchangeForLongLived(accessToken: string) {
    return tokenRequest({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: accessToken,
    });
  }

  async function fetchProfile(accessToken: string): Promise<SocialAccountProfile> {
    const response = await fetch(INSTAGRAM_ENDPOINTS.pages, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = ((await readJson(response)) ?? {}) as PagesResponse;
    if (!response.ok || body.error) {
      throw new Error(`Instagram pages request failed (HTTP ${response.status}): ${describeGraphError(body.error)}`);
    }
    // Only the first page of results is read; users with many Pages should keep the IG-linked one first.
    const linked = (body.data ?? []).map((page) => page.instagram_business_account).find((account) => account?.id);
    if (!linked?.id) throw new InstagramNoBusinessAccountError();
    return {
      externalAccountId: linked.id,
      displayName: linked.username ?? linked.id,
      // The token response does not list granted permissions; these are the requested ones.
      scopes: [...INSTAGRAM_SCOPES],
    };
  }

  return {
    platform: "instagram",

    // Meta's Login dialog does not take PKCE parameters, so the challenge is intentionally not sent.
    // The signed, user-bound state cookie still protects the callback against CSRF.
    authorizationUrl({ state, redirectUri }) {
      const url = new URL(INSTAGRAM_ENDPOINTS.authorize);
      url.search = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        state,
        response_type: "code",
        scope: INSTAGRAM_SCOPES.join(","),
      }).toString();
      return url.toString();
    },

    async exchangeCode({ code, redirectUri }) {
      const shortLived = await tokenRequest({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code });
      const tokens = await exchangeForLongLived(shortLived.accessToken);
      return { profile: await fetchProfile(tokens.accessToken), tokens };
    },

    async refreshTokens(current) {
      return exchangeForLongLived(current.accessToken);
    },
  };
}
