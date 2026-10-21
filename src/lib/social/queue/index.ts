import { join } from "node:path";
import { quotaClient } from "../../db";
import { createSocialStorage } from "../storage";
import { createSocialQueueService, type SocialQueueService } from "./service";

let queue: SocialQueueService | undefined;

/** Production wiring: the init-gated libsql client, NEXTAUTH_SECRET and the shared staging root. */
export function createSocialQueue(): SocialQueueService {
  if (queue) return queue;
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for social publishing");
  const stagingRoot = process.env.VIDEO_UPLOAD_STAGING_ROOT ?? join(process.cwd(), "staging");
  queue = createSocialQueueService({ storage: createSocialStorage({ client: quotaClient, secret }), secret, stagingRoot });
  return queue;
}
