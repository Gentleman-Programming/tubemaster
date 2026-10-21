import type { SocialOAuthConnector, SocialPublisher } from "../../contracts";
import { socialRedirectUri, type SocialOAuthEnv } from "../../oauth-state";
import type { SocialOAuthRouteConfig } from "../tiktok";
import { createInstagramConnector } from "./connector";
import { createInstagramPublisher } from "./publisher";

export { createInstagramConnector, InstagramNoBusinessAccountError } from "./connector";
export { createInstagramPublisher } from "./publisher";

type InstagramEnv = SocialOAuthEnv & {
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  NEXTAUTH_SECRET?: string;
};

export function createInstagramConnectorFromEnv(env: InstagramEnv = process.env): SocialOAuthConnector {
  const appId = env.INSTAGRAM_APP_ID;
  const appSecret = env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("Instagram is not configured: set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET");
  }
  return createInstagramConnector({ appId, appSecret });
}

export function createInstagramPublisherFromEnv(env: InstagramEnv = process.env): SocialPublisher {
  return createInstagramPublisher({ connector: createInstagramConnectorFromEnv(env) });
}

/** Everything the connect/callback routes need; throws a configuration error when anything is missing. */
export function loadInstagramOAuthConfig(env: InstagramEnv = process.env): SocialOAuthRouteConfig {
  if (!env.NEXTAUTH_SECRET) throw new Error("NEXTAUTH_SECRET is required to connect social accounts");
  return {
    connector: createInstagramConnectorFromEnv(env),
    redirectUri: socialRedirectUri("instagram", env),
    secret: env.NEXTAUTH_SECRET,
    env,
  };
}
