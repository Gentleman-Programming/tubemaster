import { NextResponse } from "next/server";
import { withAuditRoute } from "@/lib/audit/request";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db, rules } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getRecentVideos, addVideoToPlaylist } from "@/lib/youtube";

type Rule = typeof rules.$inferSelect;

function videoMatchesRule(
  video: { title: string; description: string },
  rule: Rule
): boolean {
  const field = rule.matchField === "title" ? video.title : video.description;
  const value = field.toLowerCase();
  const match = rule.matchValue.toLowerCase();

  switch (rule.matchType) {
    case "contains":
      return value.includes(match);
    case "startsWith":
      return value.startsWith(match);
    case "endsWith":
      return value.endsWith(match);
    case "equals":
      return value === match;
    default:
      return false;
  }
}

async function postHandler() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRules = (
    await db.select().from(rules).where(eq(rules.userId, session.user.id))
  ).filter((r) => r.enabled);

  if (userRules.length === 0) {
    return NextResponse.json({ matched: 0, message: "No active rules" });
  }

  const videos = await getRecentVideos(session.user.id);
  const results: { video: string; playlist: string; rule: string }[] = [];

  for (const video of videos) {
    for (const rule of userRules) {
      if (videoMatchesRule(video, rule)) {
        try {
          await addVideoToPlaylist(
            session.user.id,
            video.videoId,
            rule.playlistId
          );
          results.push({
            video: video.title,
            playlist: rule.playlistTitle,
            rule: rule.name,
          });
        } catch {
          // Video might already be in the playlist
        }
      }
    }
  }

  return NextResponse.json({ matched: results.length, results });
}

export const POST = withAuditRoute("rules.run", postHandler);
