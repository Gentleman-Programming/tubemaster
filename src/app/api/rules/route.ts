import { NextRequest, NextResponse } from "next/server";
import { withAuditRoute } from "@/lib/audit/request";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, rules } from "@/lib/db";
import { eq, and } from "drizzle-orm";

async function getHandler() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRules = await db
    .select()
    .from(rules)
    .where(eq(rules.userId, session.user.id));

  return NextResponse.json(userRules);
}

async function postHandler(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, matchField, matchType, matchValue, playlistId, playlistTitle } =
    body;

  if (!name || !matchField || !matchType || !matchValue || !playlistId) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const [rule] = await db
    .insert(rules)
    .values({
      userId: session.user.id,
      name,
      matchField,
      matchType,
      matchValue,
      playlistId,
      playlistTitle: playlistTitle ?? "",
    })
    .returning();

  return NextResponse.json(rule, { status: 201 });
}

async function deleteHandler(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing rule id" }, { status: 400 });
  }

  await db
    .delete(rules)
    .where(and(eq(rules.id, Number(id)), eq(rules.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}

export const GET = withAuditRoute("rules.list", getHandler);
export const POST = withAuditRoute("rules.create", postHandler);
export const DELETE = withAuditRoute("rules.delete", deleteHandler);
