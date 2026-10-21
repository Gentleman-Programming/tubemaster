import type { SocialPostStatus } from "@/lib/social/contracts";
import { previewBodySchema, type PreviewInput } from "@/lib/social/queue/service";
import { defaultDeps, handle, invalidInput, readJson, type SocialPostsRouteDeps } from "./http";

export const runtime = "nodejs";

export function createPostsHandlers(deps: SocialPostsRouteDeps = defaultDeps) {
  return {
    GET: (request: Request) =>
      handle(deps, async (userId, queue) => {
        const status = new URL(request.url).searchParams.get("status");
        return (await queue()).list(status === null ? { userId } : { userId, status: status as SocialPostStatus });
      }),
    // Creates a draft and returns its preview plus the confirmation token; nothing is published.
    POST: (request: Request) =>
      handle(
        deps,
        async (userId, queue) => {
          const json = await readJson(request);
          const parsed = json.ok ? previewBodySchema.safeParse(json.body) : null;
          if (!parsed?.success) return invalidInput();
          return (await queue()).preview({ ...(parsed.data as Omit<PreviewInput, "userId">), userId });
        },
        201,
      ),
  };
}

const handlers = createPostsHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
