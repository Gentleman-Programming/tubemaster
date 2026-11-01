import { getServerSession } from "next-auth";
import { withAuditRoute } from "@/lib/audit/request";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { quotaClient } from "@/lib/db";
import { YOUTUBE_QUOTA_COSTS, type QuotaOperation } from "@/lib/quota/accountant";
import {
  SQLiteQuotaRepository,
  type QuotaUsageFilter,
  type QuotaUsageSummary,
} from "@/lib/quota/repository";

type WebQuotaUsageFilter = QuotaUsageFilter & {
  channelId?: string | null;
};

type Dependencies = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  summaries: (
    userId: string,
    filters: WebQuotaUsageFilter,
  ) => Promise<QuotaUsageSummary[]>;
};

const ALLOWED_QUERY_KEYS = new Set(["bucketStart", "operation", "operationId", "channelId"]);
const CHANNEL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseFilters(rawUrl: string): WebQuotaUsageFilter | null {
  let params: URLSearchParams;
  try {
    params = new URL(rawUrl).searchParams;
  } catch {
    return null;
  }

  for (const key of params.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key) || params.getAll(key).length !== 1) {
      return null;
    }
  }

  const bucketStart = params.get("bucketStart");
  const operation = params.get("operation");
  const operationId = params.get("operationId");
  const channelId = params.get("channelId");
  if (bucketStart !== null && !isCalendarDate(bucketStart)) return null;
  if (operation !== null && !Object.hasOwn(YOUTUBE_QUOTA_COSTS, operation)) return null;
  if (operationId !== null && !OPERATION_ID_PATTERN.test(operationId)) return null;
  if (
    channelId !== null &&
    channelId !== "all" &&
    channelId !== "null" &&
    channelId !== "unassigned" &&
    !CHANNEL_ID_PATTERN.test(channelId)
  ) return null;

  return {
    ...(bucketStart === null ? {} : { bucketStart }),
    ...(operation === null ? {} : { operation: operation as QuotaOperation }),
    ...(operationId === null ? {} : { operationId }),
    ...(channelId === null || channelId === "all"
      ? {}
      : { channelId: channelId === "null" || channelId === "unassigned" ? null : channelId }),
  };
}

function invalidQueryResponse() {
  return NextResponse.json(
    { error: "Invalid quota usage query", code: "INVALID_INPUT" },
    { status: 422 },
  );
}

export function createQuotaUsageGetHandler(
  deps: Dependencies = {
    getSession: () => getServerSession(authOptions),
    summaries: (userId, filters) =>
      new SQLiteQuotaRepository(quotaClient).summarize(
        { kind: "user", userId },
        filters,
      ),
  },
) {
  return async function GET(
    request: Request = new Request("http://localhost/api/quota/usage"),
  ) {
    try {
      const session = await deps.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const filters = parseFilters(request.url);
      if (!filters) return invalidQueryResponse();

      const summaries = await deps.summaries(userId, filters);
      return NextResponse.json({ summaries });
    } catch {
      return NextResponse.json(
        { error: "Unable to load quota usage" },
        { status: 500 },
      );
    }
  };
}

export const GET = withAuditRoute("quota.usage", createQuotaUsageGetHandler());
