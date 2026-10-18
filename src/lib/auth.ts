import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { google } from "googleapis";
import { createHash, randomBytes } from "node:crypto";
import { upsertUserOAuthOnSignIn } from "./db";

export const YOUTUBE_READ_SCOPE =
  "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_WRITE_SCOPE = "https://www.googleapis.com/auth/youtube";
export const YOUTUBE_FORCE_SSL_SCOPE =
  "https://www.googleapis.com/auth/youtube.force-ssl";
export const YOUTUBE_ANALYTICS_READ_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics.readonly";

export const GOOGLE_AUTH_BASE_SCOPES = ["openid", "email", "profile"] as const;
export const YOUTUBE_SCOPES = [
  ...GOOGLE_AUTH_BASE_SCOPES,
  YOUTUBE_READ_SCOPE,
  YOUTUBE_WRITE_SCOPE,
  YOUTUBE_FORCE_SSL_SCOPE,
  YOUTUBE_ANALYTICS_READ_SCOPE,
] as const;

export const YOUTUBE_SCOPES_STRING = YOUTUBE_SCOPES.join(" ");

export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: number | null;
  scope: string | null;
  idToken: string | null;
};

export type GoogleIdentity = {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
};

function toBase64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function generateOAuthState() {
  return toBase64Url(randomBytes(24));
}

export function generatePkcePair() {
  const verifier = toBase64Url(randomBytes(64));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createGoogleOAuthClient(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

export function buildGoogleLoopbackAuthUrl(args: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}) {
  const oauthClient = createGoogleOAuthClient(args.redirectUri);
  const authUrl = oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent",
    scope: (args.scopes ?? YOUTUBE_SCOPES) as string[],
    state: args.state,
    redirect_uri: args.redirectUri,
  });

  const url = new URL(authUrl);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", args.codeChallenge);
  return url.toString();
}

function mapTokenSet(credentials: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  id_token?: string | null;
}): OAuthTokenSet {
  if (!credentials.access_token) {
    throw new Error("OAuth token exchange did not return access_token");
  }

  return {
    accessToken: credentials.access_token,
    refreshToken: credentials.refresh_token ?? null,
    tokenExpiry: credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : null,
    scope: credentials.scope ?? null,
    idToken: credentials.id_token ?? null,
  };
}

export async function exchangeGoogleAuthCode(args: {
  redirectUri: string;
  code: string;
  codeVerifier: string;
}): Promise<OAuthTokenSet> {
  const oauthClient = createGoogleOAuthClient(args.redirectUri);
  const tokenResponse = await oauthClient.getToken({
    code: args.code,
    codeVerifier: args.codeVerifier,
    redirect_uri: args.redirectUri,
  });

  return mapTokenSet(tokenResponse.tokens);
}

export type DeviceAuthorizationStart = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete: string | null;
  expiresIn: number;
  interval: number;
};

export async function startGoogleDeviceAuthorization(args?: {
  scopes?: readonly string[];
}): Promise<DeviceAuthorizationStart> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is required");
  }

  const response = await fetch("https://oauth2.googleapis.com/device/code", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      scope: (args?.scopes ?? YOUTUBE_SCOPES).join(" "),
    }),
  });

  const payload = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_url?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.device_code || !payload.user_code) {
    throw new Error(payload.error_description ?? payload.error ?? "Device authorization failed");
  }

  return {
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUrl: payload.verification_uri ?? payload.verification_url ?? "",
    verificationUrlComplete: payload.verification_uri_complete ?? null,
    expiresIn: payload.expires_in ?? 300,
    interval: payload.interval ?? 5,
  };
}

export async function pollGoogleDeviceAuthorizationToken(args: {
  deviceCode: string;
  intervalSeconds: number;
  expiresInSeconds: number;
  signal?: AbortSignal;
}): Promise<OAuthTokenSet> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required");
  }

  const deadline = Date.now() + args.expiresInSeconds * 1000;
  let interval = Math.max(2, args.intervalSeconds);

  while (Date.now() < deadline) {
    if (args.signal?.aborted) {
      throw new Error("Device authorization was cancelled");
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        device_code: args.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
      id_token?: string;
      error?: string;
      error_description?: string;
    };

    if (response.ok && payload.access_token) {
      return {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token ?? null,
        tokenExpiry: payload.expires_in
          ? Math.floor(Date.now() / 1000) + payload.expires_in
          : null,
        scope: payload.scope ?? null,
        idToken: payload.id_token ?? null,
      };
    }

    if (payload.error === "authorization_pending") {
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      continue;
    }

    if (payload.error === "slow_down") {
      interval += 5;
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      continue;
    }

    if (payload.error === "access_denied") {
      throw new Error("Device authorization denied by user");
    }

    throw new Error(payload.error_description ?? payload.error ?? "Device authorization failed");
  }

  throw new Error("Device authorization timed out");
}

function decodeIdentityFromIdToken(idToken: string | null): GoogleIdentity | null {
  if (!idToken) return null;

  const [, payloadBase64] = idToken.split(".");
  if (!payloadBase64) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8")) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    if (!decoded.sub || !decoded.email) return null;

    return {
      userId: decoded.sub,
      email: decoded.email,
      name: decoded.name ?? null,
      image: decoded.picture ?? null,
    };
  } catch {
    return null;
  }
}

export async function fetchGoogleIdentity(args: {
  accessToken: string;
  idToken?: string | null;
}): Promise<GoogleIdentity> {
  const fromIdToken = decodeIdentityFromIdToken(args.idToken ?? null);
  if (fromIdToken) return fromIdToken;

  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: {
      authorization: `Bearer ${args.accessToken}`,
    },
  });

  const payload = (await response.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };

  if (!response.ok || !payload.sub || !payload.email) {
    throw new Error("Unable to fetch user identity from Google");
  }

  return {
    userId: payload.sub,
    email: payload.email,
    name: payload.name ?? null,
    image: payload.picture ?? null,
  };
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });

  if (!response.ok) {
    throw new Error("Google token revoke request failed");
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: YOUTUBE_SCOPES_STRING,
          access_type: "offline",
          prompt: "select_account consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (!account) return false;

      await upsertUserOAuthOnSignIn({
        userId: user.id,
        name: user.name ?? null,
        email: user.email!,
        image: user.image ?? null,
        accessToken: account.access_token ?? null,
        refreshToken: account.refresh_token ?? null,
        tokenExpiry: account.expires_at ?? null,
        scope: account.scope ?? null,
      });

      return true;
    },
    async session({ session, token }) {
      if (token.sub) {
        session.user = { ...session.user, id: token.sub };
      }
      return session;
    },
    async jwt({ token }) {
      return token;
    },
  },
};
