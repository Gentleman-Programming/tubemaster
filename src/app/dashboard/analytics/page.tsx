"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useState } from "react";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { AnalyticsRetentionDashboard } from "@/components/analytics-retention-dashboard";
import { Button, Card } from "@/components/ui";

type AnalyticsTab = "summary" | "retention";

export default function AnalyticsPage() {
  const { status } = useSession();
  const [tab, setTab] = useState<AnalyticsTab>("summary");

  if (status === "loading") return <p role="status" className="font-mono text-sm text-subtle">Loading…</p>;
  if (status !== "authenticated") redirect("/");

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Analytics</h1>
        <p className="mt-2 max-w-3xl text-sm text-subtle">Review channel performance and audience retention in one read-only workspace.</p>
      </div>
      <Card className="space-y-5">
        <div className="flex h-10 items-stretch gap-1 rounded-panel border border-line bg-panel/40 p-1" aria-label="Analytics tabs">
          <Button variant={tab === "summary" ? "primary" : "ghost"} className="flex-1" aria-pressed={tab === "summary"} onClick={() => setTab("summary")}>Channel analytics</Button>
          <Button variant={tab === "retention" ? "primary" : "ghost"} className="flex-1" aria-pressed={tab === "retention"} onClick={() => setTab("retention")}>Video retention</Button>
        </div>
        {tab === "summary" ? <AnalyticsDashboard /> : <AnalyticsRetentionDashboard />}
      </Card>
    </main>
  );
}
