import { getServerSession } from "next-auth";
import { withAuditRoute } from "@/lib/audit/request";
import { authOptions } from "@/lib/auth";
import { StageError, stageVideo } from "@/lib/video-upload/staging";

export const runtime = "nodejs";

export function createStagePostHandler(deps: {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  stage: (request: Request) => Promise<{ stagingFile: string; filename: string; size: number }>;
} = {
  getSession: () => getServerSession(authOptions),
  stage: (request) => stageVideo(request, process.env.VIDEO_UPLOAD_STAGING_ROOT ?? `${process.cwd()}/staging`, Number(process.env.VIDEO_UPLOAD_MAX_BYTES ?? 2 * 1024 * 1024 * 1024)),
}) {
  return async function POST(request: Request) {
    try {
      if (!(await deps.getSession())?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });
      const staged = await deps.stage(request);
      return Response.json(staged);
    } catch (error) {
      if (error instanceof StageError) return Response.json({ error: "validation_failed" }, { status: 400 });
      return Response.json({ error: "staging_failed" }, { status: 500 });
    }
  };
}

export const POST = withAuditRoute("youtube.upload.stage", createStagePostHandler());
