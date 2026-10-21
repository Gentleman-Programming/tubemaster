import type { QueueErrorCode, QueueResult, SocialQueueService } from "@/lib/social/queue/service";

export type SocialQueueCore = Pick<SocialQueueService, "preview" | "confirm" | "reschedule" | "cancel" | "list" | "get">;

export type SocialPostsRouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  getQueue: () => Promise<SocialQueueCore>;
};

export type IdRouteContext = { params: Promise<{ id: string }> };

// Production modules are imported lazily so importing a route never opens the real database.
export const defaultDeps: SocialPostsRouteDeps = {
  getSession: async () => {
    const [{ getServerSession }, { authOptions }] = await Promise.all([import("next-auth"), import("@/lib/auth")]);
    return getServerSession(authOptions);
  },
  getQueue: async () => (await import("@/lib/social/queue")).createSocialQueue(),
};

const STATUS_BY_CODE: Record<QueueErrorCode, number> = {
  INVALID_INPUT: 422,
  STAGED_VIDEO_INVALID: 422,
  ACCOUNT_NOT_CONNECTED: 409,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  CONFIRMATION_INVALID: 403,
  CONFIRMATION_EXPIRED: 403,
};

export const invalidInput = (message = "Invalid request body") =>
  Response.json({ error: "INVALID_INPUT", message }, { status: 422 });

const internalError = () => Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

/** Authenticates, runs the core call and maps typed queue errors; unexpected failures stay opaque. */
export async function handle<T>(
  deps: SocialPostsRouteDeps,
  run: (userId: string, queue: () => Promise<SocialQueueCore>) => Promise<QueueResult<T> | Response>,
  successStatus = 200,
): Promise<Response> {
  const session = await deps.getSession();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const result = await run(userId, deps.getQueue);
    if (result instanceof Response) return result;
    if (result.ok) return Response.json(result.value, { status: successStatus });
    const { code, message } = result.error;
    if (!Object.hasOwn(STATUS_BY_CODE, code)) return internalError();
    return Response.json({ error: code, message }, { status: STATUS_BY_CODE[code] });
  } catch {
    return internalError();
  }
}
