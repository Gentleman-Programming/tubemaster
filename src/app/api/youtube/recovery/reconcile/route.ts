import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createVideoRecoveryCore } from "@/lib/video-recovery";
import { isDomainError } from "@/lib/video-metadata/contracts";

export const runtime = "nodejs";

function bindUser(userId: string, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body) || "credentialRef" in body) return null;
  return { ...body, credentialRef: { userId } };
}

function responseFor(error: unknown) {
  if (!isDomainError(error)) return Response.json({ error: "internal_error" }, { status: 500 });
  const details = error.details as Record<string, unknown> | undefined;
  return Response.json({ error: error.code, ...(details?.outcome === "unknown" ? { outcome: "unknown", operationId: details.operationId, retryAutomatically: false } : {}) }, {
    status: error.code === "unauthorized" || error.code.startsWith("AUTH_") ? 401 : error.code === "validation_failed" || error.code.startsWith("WRITE_CHANNEL_") ? 400 : 502,
  });
}

export function createRecoveryReconcilePostHandler(deps: {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  reconcile: (userId: string, body: unknown) => Promise<unknown>;
} = {
  getSession: () => getServerSession(authOptions),
  reconcile: (_userId, body) => createVideoRecoveryCore().reconcile(body),
}) {
  return async function POST(request: Request) {
    const session = await deps.getSession();
    if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "validation_failed" }, { status: 400 }); }
    const boundBody = bindUser(session.user.id, body);
    if (!boundBody) return Response.json({ error: "validation_failed" }, { status: 400 });
    try { return Response.json(await deps.reconcile(session.user.id, boundBody)); } catch (error) { return responseFor(error); }
  };
}

export const POST = createRecoveryReconcilePostHandler();
