import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { createBestPublishTimes } from "@/lib/youtube-best-publish-times";
import type { BestPublishTimesResponse } from "@/lib/youtube-best-publish-times";

type RouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  core: {
    fetchBestPublishTimes: (args: {
      credentialRef: { userId: string };
      timezone: string;
    }) => Promise<BestPublishTimesResponse>;
  };
};
const status: Record<string, number> = {
  AUTH_REQUIRED: 401,
  AUTH_SCOPE_INSUFFICIENT: 403,
  INVALID_INPUT: 422,
  ANALYTICS_API_ERROR: 502,
};
const internalError = () =>
  NextResponse.json(
    {
      kind: "best-publish-times-error",
      code: "ANALYTICS_API_ERROR",
      message: "Internal error",
    },
    { status: 500 },
  );

export function createBestPublishTimesGetHandler(
  deps: RouteDeps = {
    getSession: () => getServerSession(authOptions),
    core: createBestPublishTimes(),
  },
) {
  return async (url: URL) => {
    const session = await deps.getSession();
    if (!session?.user?.id)
      return NextResponse.json(
        {
          kind: "best-publish-times-error",
          code: "AUTH_REQUIRED",
          message: "Authentication required",
        },
        { status: 401 },
      );
    try {
      const result = await deps.core.fetchBestPublishTimes({
        credentialRef: { userId: session.user.id },
        timezone: url.searchParams.get("timezone") ?? "",
      });
      return result.kind === "best-publish-times-error"
        ? NextResponse.json(result, { status: status[result.code] ?? 500 })
        : NextResponse.json(result);
    } catch {
      return internalError();
    }
  };
}
export async function GET(request: Request) {
  try {
    return await createBestPublishTimesGetHandler()(new URL(request.url));
  } catch {
    return internalError();
  }
}
