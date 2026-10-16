import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSelectedChannelId, setSelectedChannelId, quotaClient } from "@/lib/db";
import { createDurableQuotaAccountant } from "@/lib/quota/accountant";
import { resolveGoogleCredentials } from "@/lib/video-metadata/adapters/google-auth";
import { isDomainError } from "@/lib/video-metadata/contracts";
import { createWriteContextYoutubeApiAdapter } from "@/lib/write-context/adapters/youtube-api";
import { createWriteContextService } from "@/lib/write-context/service";
import { createVideoSchedulingService } from "@/lib/video-scheduling/services";
import { youtubeSchedulingProvider } from "@/lib/video-scheduling/adapters/youtube-api";

export const runtime = "nodejs";

export function createSchedulePostHandler(deps: {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  schedule: (userId: string, body: unknown) => Promise<unknown>;
} = {
  getSession: () => getServerSession(authOptions),
  schedule: (userId, body) => {
    const secret = process.env.NEXTAUTH_SECRET ?? "";
    const schedule = createVideoSchedulingService({
      authResolver: { resolve: resolveGoogleCredentials },
      writeContext: createWriteContextService({ youtubeApi: createWriteContextYoutubeApiAdapter(), channelSelectionStore: { getSelectedChannelId, setSelectedChannelId } }),
      provider: youtubeSchedulingProvider,
      quotaAccountantFactory: () => createDurableQuotaAccountant({ client: quotaClient, scope: { kind: "user", userId } }),
      confirmationSecret: secret,
    });
    if (!body || typeof body !== "object" || Array.isArray(body) || "credentialRef" in body) {
      return schedule(null); // schema rejects credential injection
    }
    return schedule({ ...body, credentialRef: { userId } });
  },
}) {
  return async function POST(request: Request) {
    const session = await deps.getSession();
    if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
    let body: unknown;
    try { body = await request.json(); } catch { return Response.json({ error: "validation_failed" }, { status: 400 }); }
    try { return Response.json(await deps.schedule(session.user.id, body)); }
    catch (error) {
      if (!isDomainError(error)) return Response.json({ error: "internal_error" }, { status: 500 });
      const details = error.details as Record<string, unknown> | undefined;
      const uncertain = details?.outcome === "unknown";
      return Response.json({ error: error.code,
        ...(uncertain ? { outcome: "unknown", operationId: details?.operationId, retryAutomatically: false } : {}),
      }, { status: error.code === "unauthorized" || error.code.startsWith("AUTH_") ? 401 : error.code === "validation_failed" || error.code.startsWith("WRITE_CHANNEL_") ? 400 : 502 });
    }
  };
}

export const POST = createSchedulePostHandler();
