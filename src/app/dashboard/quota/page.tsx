"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  formatBucket,
  formatChannelId,
  isQuotaSummary,
  type QuotaSummary,
} from "./format";
import { EmptyState } from "@/components/ui";

type UsageState =
  | { kind: "loading" }
  | { kind: "ready"; summaries: QuotaSummary[] }
  | { kind: "unauthorized" }
  | { kind: "error" };

export default function QuotaPage() {
  const { status } = useSession();
  const [usage, setUsage] = useState<UsageState>({ kind: "loading" });

  useEffect(() => {
    if (status !== "authenticated") return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/quota/usage", { signal: controller.signal });
        if (response.status === 401) {
          setUsage({ kind: "unauthorized" });
          return;
        }
        if (!response.ok) throw new Error("Quota request failed");
        const payload: unknown = await response.json();
        if (typeof payload !== "object" || payload === null ||
          !("summaries" in payload) || !Array.isArray(payload.summaries) ||
          !payload.summaries.every(isQuotaSummary)) {
          throw new Error("Invalid quota response");
        }
        setUsage({ kind: "ready", summaries: payload.summaries });
      } catch {
        if (!controller.signal.aborted) setUsage({ kind: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [status]);

  const unauthorized = status === "unauthenticated" || usage.kind === "unauthorized";
  return (
    <main>
      <Link href="/dashboard" className="rounded-control font-mono text-sm text-subtle transition-colors hover:text-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose">← Dashboard</Link>
      <h1 className="mt-6 text-2xl font-bold text-fg">Quota usage</h1>
      <p className="mt-2 text-sm text-subtle">
        Estimated YouTube API units recorded by TubeMaster. These estimates are not authoritative Google quota usage or remaining quota.
      </p>
      <div className="mt-8" aria-live="polite">
        {unauthorized ? (
          <EmptyState title="Sign in to view your quota usage." />
        ) : status === "loading" || usage.kind === "loading" ? (
          <p className="font-mono text-sm text-subtle">Loading quota usage...</p>
        ) : usage.kind === "error" ? (
          <p className="rounded-panel border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">Unable to load quota usage. Please try again later.</p>
        ) : usage.summaries.length === 0 ? (
          <EmptyState title="No quota usage recorded yet." />
        ) : (
          <div className="overflow-x-auto rounded-card border border-line bg-surface-2 mask-r-from-85% md:mask-none">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface font-mono text-xs uppercase tracking-wider text-muted"><tr>
                <th scope="col" className="whitespace-nowrap p-3 font-medium">Bucket date</th>
                <th scope="col" className="p-3 font-medium">Operation</th>
                <th scope="col" className="p-3 font-medium">Channel</th>
                <th scope="col" className="p-3 text-right font-medium">Count</th>
                <th scope="col" className="p-3 text-right font-medium">Estimated units</th>
              </tr></thead>
              <tbody>{usage.summaries.map((row, index) => (
                <tr key={`${row.bucketStart}-${row.operation}-${row.channelId ?? "unassigned"}-${index}`} className="border-t border-line-soft text-dim transition-colors hover:bg-glass">
                  <td className="whitespace-nowrap p-3 font-mono text-fg">{formatBucket(row.bucketStart)}</td>
                  <td className="p-3 font-mono text-sky">{row.operation}</td>
                  <td className="p-3 font-mono text-xs text-subtle">{formatChannelId(row.channelId)}</td>
                  <td className="p-3 text-right font-mono">{row.operationCount.toLocaleString()}</td>
                  <td className="p-3 text-right font-mono font-semibold text-rose">{row.estimatedUnits.toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
