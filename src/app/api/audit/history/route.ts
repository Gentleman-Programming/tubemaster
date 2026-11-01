import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { auditEventRepository } from "@/lib/db";
import type { SQLiteAuditRepository } from "@/lib/audit/repository";

export type AuditHistorySession = { user?: { id?: string | null } | null } | null;

type Dependencies = {
  getSession: () => Promise<AuditHistorySession>;
  repository: Pick<SQLiteAuditRepository, "listForUser" | "purgeExpired">;
};

function parseLimit(request: Request): number | null {
  const url = new URL(request.url);
  const values = [...url.searchParams.keys()];
  if (values.some((key) => key !== "limit") || url.searchParams.getAll("limit").length > 1) return null;
  const raw = url.searchParams.get("limit");
  if (raw === null) return 100;
  if (!/^[1-9][0-9]{0,2}$/.test(raw)) return null;
  const limit = Number(raw);
  return limit >= 1 && limit <= 100 ? limit : null;
}

export function createAuditHistoryGetHandler(
  deps: Dependencies = {
    getSession: () => getServerSession(authOptions),
    repository: auditEventRepository,
  },
) {
  return async function GET(request: Request) {
    const session = await deps.getSession();
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const limit = parseLimit(request);
    if (limit === null) return NextResponse.json({ error: "Invalid limit" }, { status: 422 });

    try {
      await deps.repository.purgeExpired(new Date());
      const events = await deps.repository.listForUser(userId, limit);
      return NextResponse.json({ events });
    } catch {
      return NextResponse.json({ error: "Unable to load audit history" }, { status: 503 });
    }
  };
}

export const GET = createAuditHistoryGetHandler();
