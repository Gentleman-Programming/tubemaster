import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createSemanticSearchService, type SemanticSearchService } from "@/lib/video-metadata/semantic-search-service";

type IndexDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  service: SemanticSearchService;
};

function bodyValue(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

export function createSemanticSearchIndexHandler(
  deps: IndexDeps = { getSession: () => getServerSession(authOptions), service: createSemanticSearchService() },
) {
  return async function POST(request: Request) {
    const session = await deps.getSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const body: unknown = await request.json();
      const videoId = bodyValue(body, "videoId");
      if (typeof videoId !== "string" || !videoId.trim()) {
        return NextResponse.json({ error: "validation_failed", message: "Enter a valid YouTube video ID" }, { status: 400 });
      }
      const result = await deps.service.indexVideo({ userId: session.user.id, videoId: videoId.trim() });
      return NextResponse.json({ indexed: true, ...result });
    } catch (error) {
      const message = error instanceof RangeError ? error.message : "Unable to index this video right now";
      const status = error instanceof RangeError ? 400 : 422;
      return NextResponse.json({ error: "semantic_search_unavailable", message }, { status });
    }
  };
}

export const POST = createSemanticSearchIndexHandler();
