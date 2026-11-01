import { getServerSession } from "next-auth";
import { withAuditRoute } from "@/lib/audit/request";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { DomainError } from "@/lib/video-metadata/contracts";
import { createVideoMetadataCore } from "@/lib/video-metadata";
import { getVideoMetadataErrorStatus } from "../error-status";
import { parseVideoMetadataJsonBody } from "../parse-json-body";

type BatchPreviewRouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  core: Pick<ReturnType<typeof createVideoMetadataCore>, "previewMetadataBatch">;
};

export function createBatchPreviewPostHandler(
  deps: BatchPreviewRouteDeps = {
    getSession: () => getServerSession(authOptions),
    core: createVideoMetadataCore(),
  }
) {
  return async function POST(request: Request) {
    const session = await deps.getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const payload = await parseVideoMetadataJsonBody(request);
      const result = await deps.core.previewMetadataBatch({
        ...payload,
        credentialRef: { userId: session.user.id },
      });
      return NextResponse.json(result);
    } catch (error) {
      if (error instanceof DomainError) {
        return NextResponse.json(
          { error: error.code, message: error.message, details: error.details },
          { status: getVideoMetadataErrorStatus(error.code) }
        );
      }
      return NextResponse.json(
        { error: "internal_error", message: error instanceof Error ? error.message : "Unknown error" },
        { status: 500 }
      );
    }
  };
}

export const POST = withAuditRoute("video-metadata.batch-preview", createBatchPreviewPostHandler());
