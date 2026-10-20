import { z } from "zod";
import { defaultDeps, handle, invalidInput, readJson, type IdRouteContext, type SocialPostsRouteDeps } from "../../http";

export const runtime = "nodejs";

const bodySchema = z.strictObject({ confirmationToken: z.string().min(1).max(256) });

export function createConfirmHandler(deps: SocialPostsRouteDeps = defaultDeps) {
  return (request: Request, context: IdRouteContext) =>
    handle(deps, async (userId, queue) => {
      const json = await readJson(request);
      const parsed = json.ok ? bodySchema.safeParse(json.body) : null;
      if (!parsed?.success) return invalidInput();
      const { id } = await context.params;
      return (await queue()).confirm({ userId, postId: id, confirmationToken: parsed.data.confirmationToken });
    });
}

export const POST = createConfirmHandler();
