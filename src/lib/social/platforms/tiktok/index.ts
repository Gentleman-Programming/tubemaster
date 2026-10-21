import type { SocialOAuthConnector, SocialPublisher } from "../../contracts";
import { socialRedirectUri, type SocialOAuthEnv } from "../../oauth-state";
import { createTikTokConnector } from "./connector";
import { createTikTokPublisher } from "./publisher";

export { computeTikTokChunks, createTikTokPublisher } from "./publisher";
export { createTikTokConnector } from "./connector";

type TikTokEnv = SocialOAuthEnv & {
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  NEXTAUTH_SECRET?: string;
};

export type SocialOAuthRouteConfig = {
  connector: SocialOAuthConnector;
  redirectUri: string;
  secret: string;
  env: SocialOAuthEnv;
};

export function createTikTokConnectorFromEnv(env: TikTokEnv = process.env): SocialOAuthConnector {
  const clientKey = env.TIKTOK_CLIENT_KEY;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error("TikTok is not configured: set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET");
  }
  return createTikTokConnector({ clientKey, clientSecret });
}

export function createTikTokPublisherFromEnv(env: TikTokEnv = process.env): SocialPublisher {
  return createTikTokPublisher({ connector: createTikTokConnectorFromEnv(env) });
}

/** Everything the connect/callback routes need; throws a configuration error when anything is missing. */
export function loadTikTokOAuthConfig(env: TikTokEnv = process.env): SocialOAuthRouteConfig {
  if (!env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET is required to connect social accounts");
  return {
    connector: createTikTokConnectorFromEnv(env),
    redirectUri: socialRedirectUri("tiktok", env),
    secret: env.NEXTAUTH_SECRET,
    env,
  };
}
