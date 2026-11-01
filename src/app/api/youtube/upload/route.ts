import { getServerSession } from "next-auth";
import { withAuditRoute } from "@/lib/audit/request";
import { authOptions } from "@/lib/auth";
import { createVideoUploadCore } from "@/lib/video-upload";
import { createUploadAdapter } from "@/lib/video-upload/adapter";
import { isDomainError } from "@/lib/video-metadata/contracts";

export const runtime = "nodejs";

export function createUploadPostHandler(deps: {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  upload: (userId: string, body: unknown) => Promise<unknown>;
} = {
  getSession: () => getServerSession(authOptions),
  upload: createUploadAdapter({
    upload: createVideoUploadCore(),
    stagingRoot: process.env.VIDEO_UPLOAD_STAGING_ROOT ?? `${process.cwd()}/staging`,
    maxBytes: Number(process.env.VIDEO_UPLOAD_MAX_BYTES ?? 2 * 1024 * 1024 * 1024),
  }),
}) {
  return async function POST(request: Request) {
    const session = await deps.getSession();
    if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "validation_failed" }, { status: 400 });
    }
    try {
      const result = await deps.upload(session.user.id, body);
      return Response.json(result);
    } catch (error) {
      if (!isDomainError(error)) return Response.json({ error: "internal_error" }, { status: 500 });
      const details = error.details as Record<string, unknown> | undefined;
      const uncertain = details?.outcome === "unknown";
      return Response.json({
        error: error.code,
        ...(uncertain ? { outcome: "unknown", operationId: details?.operationId, retryAutomatically: false } : {}),
      }, { status: error.code === "unauthorized" || error.code.startsWith("AUTH_") ? 401 : error.code === "validation_failed" || error.code.startsWith("WRITE_CHANNEL_") ? 400 : 502 });
    }
  };
}

export const POST = withAuditRoute("youtube.upload", createUploadPostHandler());
