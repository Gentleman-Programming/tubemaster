import type { SocialPlatform, SocialPublisher } from "../contracts";

type PublisherEnv = Record<string, string | undefined>;

/**
 * Publishers for every platform whose developer-app credentials are configured. Platform modules are
 * imported lazily so an unconfigured platform costs nothing; its posts fail as PLATFORM_UNAVAILABLE.
 */
export async function loadPublishers(
  env: PublisherEnv = process.env,
): Promise<Partial<Record<SocialPlatform, SocialPublisher>>> {
  const publishers: Partial<Record<SocialPlatform, SocialPublisher>> = {};

  if (env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET) {
    const { createTikTokPublisherFromEnv } = await import("../platforms/tiktok");
    publishers.tiktok = createTikTokPublisherFromEnv(env);
  }

  if (env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET) {
    const { createInstagramPublisherFromEnv } = await import("../platforms/instagram");
    publishers.instagram = createInstagramPublisherFromEnv(env);
  }

  return publishers;
}
