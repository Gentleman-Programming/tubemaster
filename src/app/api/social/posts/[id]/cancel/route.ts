import { defaultDeps, handle, type IdRouteContext, type SocialPostsRouteDeps } from "../../http";

export const runtime = "nodejs";

export function createCancelHandler(deps: SocialPostsRouteDeps = defaultDeps) {
  return (_request: Request, context: IdRouteContext) =>
    handle(deps, async (userId, queue) => (await queue()).cancel({ userId, postId: (await context.params).id }));
}

export const POST = createCancelHandler();
