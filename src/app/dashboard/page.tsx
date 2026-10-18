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
        <p className="text-zinc-500">Loading...</p>
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
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <AnalyticsDashboard />
      <TranscriptDashboard />

      <div className="mb-6 flex gap-1 rounded-lg bg-zinc-900 p-1">
        <button
          onClick={() => setTab("manual")}
          aria-pressed={tab === "manual"}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
            tab === "manual"
              ? "bg-zinc-800 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Manual
        </button>
        <button
          onClick={() => setTab("rules")}
          aria-pressed={tab === "rules"}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
            tab === "rules"
              ? "bg-zinc-800 text-white"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Rules
        </button>
      </div>

      {tab === "manual" ? (
        <div>
          <p className="mb-4 text-sm text-zinc-400">
            Select videos and add them to a playlist directly.
          </p>
          <ManualMode />
        </div>
      ) : (
        <div className="space-y-8">
          <RuleForm onCreated={fetchRules} />

          <div>
            <h2 className="mb-4 text-lg font-semibold">Your Rules</h2>
            <RuleList rules={rules} onDelete={handleDelete} />
          </div>

          <div>
            <h2 className="mb-4 text-lg font-semibold">Execute</h2>
            <p className="mb-3 text-sm text-zinc-400">
              Run your rules against your recent videos.
            </p>
            <RunButton />
          </div>
        </div>
      )}
    </main>
  );
}
