import type { SocialAccountProfile, SocialAccountTokens, SocialOAuthConnector } from "../../contracts";
import { TIKTOK_ENDPOINTS, TIKTOK_SCOPES } from "./endpoints";

export type TikTokConnectorOptions = {
  clientKey: string;
  clientSecret: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

type UserInfoResponse = {
  data?: { user?: { open_id?: string; display_name?: string } };
  error?: { code?: string };
};

/** Only provider error identifiers are surfaced; descriptions may echo request data. */
export function safeProviderCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createTikTokConnector({
  clientKey,
  clientSecret,
  fetch = globalThis.fetch,
  now = () => new Date(),
}: TikTokConnectorOptions): SocialOAuthConnector {
  async function tokenRequest(params: Record<string, string>): Promise<SocialAccountTokens & { scope?: string }> {
    const response = await fetch(TIKTOK_ENDPOINTS.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, ...params }).toString(),
    });
    const body = ((await readJson(response)) ?? {}) as TokenResponse;
    if (!response.ok || body.error || !body.access_token) {
      const code = safeProviderCode(body.error) ?? "unknown_error";
      throw new Error(`TikTok token request failed (HTTP ${response.status}): ${code}`);
    }
    const tokens: SocialAccountTokens & { scope?: string } = { accessToken: body.access_token };
    if (body.refresh_token) tokens.refreshToken = body.refresh_token;
    if (typeof body.expires_in === "number") {
      tokens.expiresAt = new Date(now().getTime() + body.expires_in * 1000).toISOString();
    }
    if (typeof body.scope === "string") tokens.scope = body.scope;
    return tokens;
  }

  async function fetchProfile(accessToken: string, scope: string | undefined): Promise<SocialAccountProfile> {
    const response = await fetch(TIKTOK_ENDPOINTS.userInfo, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = ((await readJson(response)) ?? {}) as UserInfoResponse;
    const user = body.data?.user;
    if (!response.ok || (body.error?.code && body.error.code !== "ok") || !user?.open_id) {
      const code = safeProviderCode(body.error?.code) ?? `HTTP ${response.status}`;
      throw new Error(`TikTok user info request failed: ${code}`);
    }
    return {
      externalAccountId: user.open_id,
      displayName: user.display_name ?? user.open_id,
      scopes: (scope ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    };
  }

  return {
    platform: "tiktok",

    authorizationUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL(TIKTOK_ENDPOINTS.authorize);
      url.search = new URLSearchParams({
        client_key: clientKey,
        scope: TIKTOK_SCOPES.join(","),
        response_type: "code",
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString();
      return url.toString();
    },

    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const { scope, ...tokens } = await tokenRequest({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      });
      return { profile: await fetchProfile(tokens.accessToken, scope), tokens };
    },

    async refreshTokens(current) {
      if (!current.refreshToken) throw new Error("TikTok account has no refresh token; reconnect it");
      const { accessToken, refreshToken, expiresAt } = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: current.refreshToken,
      });
      return { accessToken, ...(refreshToken ? { refreshToken } : {}), ...(expiresAt ? { expiresAt } : {}) };
    },
  };
}
