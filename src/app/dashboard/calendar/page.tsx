"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { ScheduleCalendar } from "@/components/schedule-calendar";
import { Card, SectionHeader } from "@/components/ui";

export default function CalendarPage() {
  const { status } = useSession();

  if (status === "loading") return <p role="status" className="font-mono text-sm text-subtle">Loading…</p>;
  if (status !== "authenticated") redirect("/");

  return (
    <main className="space-y-6">
      <SectionHeader
        headingLevel={1}
        title="Calendar"
        description="Every scheduled TikTok and Instagram post, plus YouTube videos with a scheduled publish time. Pick a future day or hour to create a post."
        className="[&_h1]:text-2xl [&_h1]:font-bold"
      />
      <Card aria-label="Schedules calendar">
        <ScheduleCalendar />
      </Card>
    </main>
  );
}
