"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { RuleForm } from "@/components/rule-form";
import { RuleList } from "@/components/rule-list";
import { RunButton } from "@/components/run-button";
import { ManualMode } from "@/components/manual-mode";
import { TranscriptDashboard } from "@/components/transcript-dashboard";
import { AnalyticsDashboard } from "@/components/analytics-dashboard";
import { BestPublishTimesPanel } from "@/components/best-publish-times-panel";
import { cn } from "@/lib/cn";

type Rule = {
  id: number;
  name: string;
  matchField: string;
  matchType: string;
  matchValue: string;
  playlistTitle: string;
  enabled: boolean;
};

type Tab = "manual" | "rules";

const tabClasses =
  "flex-1 rounded-control px-4 font-mono text-xs uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose";
const activeTabClasses = "border border-rose/30 bg-rose/10 text-rose";
const inactiveTabClasses = "border border-transparent text-subtle hover:bg-glass-2 hover:text-fg";

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [rules, setRules] = useState<Rule[]>([]);
  const [tab, setTab] = useState<Tab>("manual");
  const fetchRules = useCallback(async () => {
    const res = await fetch("/api/rules");
    const data = await res.json();
    setRules(data);
  }, []);

  useEffect(() => {
    if (session) {
      queueMicrotask(() => {
        void fetchRules();
      });
    }
  }, [session, fetchRules]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="font-mono text-sm text-subtle">Loading...</p>
      </div>
    );
  }

  if (!session) {
    redirect("/");
  }

  async function handleDelete(id: number) {
    await fetch(`/api/rules?id=${id}`, { method: "DELETE" });
    fetchRules();
  }

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Dashboard</h1>
      <AnalyticsDashboard />
      <BestPublishTimesPanel />
      <TranscriptDashboard />

      <div className="mb-6 flex h-10 items-stretch gap-1 rounded-panel border border-line bg-panel/40 p-1">
        <button
          onClick={() => setTab("manual")}
          aria-pressed={tab === "manual"}
          className={cn(
            tabClasses,
            tab === "manual" ? activeTabClasses : inactiveTabClasses,
          )}
        >
          Manual
        </button>
        <button
          onClick={() => setTab("rules")}
          aria-pressed={tab === "rules"}
          className={cn(
            tabClasses,
            tab === "rules" ? activeTabClasses : inactiveTabClasses,
          )}
        >
          Rules
        </button>
      </div>

      {tab === "manual" ? (
        <div>
          <p className="mb-4 text-sm text-subtle">
            Select videos and add them to a playlist directly.
          </p>
          <ManualMode />
        </div>
      ) : (
        <div className="space-y-8">
          <RuleForm onCreated={fetchRules} />

          <div>
            <h2 className="mb-4 text-lg font-semibold text-fg">Your Rules</h2>
            <RuleList rules={rules} onDelete={handleDelete} />
          </div>

          <div>
            <h2 className="mb-4 text-lg font-semibold text-fg">Execute</h2>
            <p className="mb-3 text-sm text-subtle">
              Run your rules against your recent videos.
            </p>
            <RunButton />
          </div>
        </div>
      )}
    </main>
  );
}
