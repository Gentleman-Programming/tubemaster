import { defaultDeps, handle, type IdRouteContext, type SocialPostsRouteDeps } from "../http";

export const runtime = "nodejs";

export function createPostHandlers(deps: SocialPostsRouteDeps = defaultDeps) {
  return {
    GET: (_request: Request, context: IdRouteContext) =>
      handle(deps, async (userId, queue) => (await queue()).get({ userId, postId: (await context.params).id })),
  };
}

export const GET = createPostHandlers().GET;
