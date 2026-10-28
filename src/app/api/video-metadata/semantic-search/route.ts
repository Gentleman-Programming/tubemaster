import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createSemanticSearchService, type SemanticSearchService } from "@/lib/video-metadata/semantic-search-service";

type SearchDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  service: SemanticSearchService;
};

function valueOf(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

export function createSemanticSearchHandler(
  deps: SearchDeps = { getSession: () => getServerSession(authOptions), service: createSemanticSearchService() },
) {
  return async function POST(request: Request) {
    const session = await deps.getSession();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
      const body: unknown = await request.json();
      const query = valueOf(body, "query");
      const rawLimit = valueOf(body, "limit");
      const limit = rawLimit === undefined ? undefined : Number(rawLimit);
      if (typeof query !== "string" || !query.trim()) {
        return NextResponse.json({ error: "validation_failed", message: "Enter a search query" }, { status: 400 });
      }
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 20)) {
        return NextResponse.json({ error: "validation_failed", message: "Result limit must be between 1 and 20" }, { status: 400 });
      }
      const results = await deps.service.search({ userId: session.user.id, query: query.trim(), limit });
      return NextResponse.json({ results });
    } catch (error) {
      const message = error instanceof RangeError ? error.message : "Semantic search is unavailable right now";
      const status = error instanceof RangeError ? 400 : 422;
      return NextResponse.json({ error: "semantic_search_unavailable", message }, { status });
    }
  };
}

export const POST = createSemanticSearchHandler();
