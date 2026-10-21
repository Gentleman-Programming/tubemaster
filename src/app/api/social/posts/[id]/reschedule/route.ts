import { z } from "zod";
import { scheduleSchema } from "@/lib/social/queue/service";
import { defaultDeps, handle, invalidInput, readJson, type IdRouteContext, type SocialPostsRouteDeps } from "../../http";

export const runtime = "nodejs";

const bodySchema = z.strictObject({ schedule: scheduleSchema });

export function createRescheduleHandler(deps: SocialPostsRouteDeps = defaultDeps) {
  return (request: Request, context: IdRouteContext) =>
    handle(deps, async (userId, queue) => {
      const json = await readJson(request);
      const parsed = json.ok ? bodySchema.safeParse(json.body) : null;
      if (!parsed?.success) return invalidInput();
      const { id } = await context.params;
      return (await queue()).reschedule({ userId, postId: id, schedule: parsed.data.schedule });
    });
}

export const POST = createRescheduleHandler();
