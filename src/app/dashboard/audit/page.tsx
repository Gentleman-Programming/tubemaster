"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui";

type AuditEvent = {
  id: number;
  operationId: string;
  event: string;
  timestamp: string;
  context: Record<string, string | number | boolean>;
};

type AuditState =
  | { kind: "loading" }
  | { kind: "ready"; events: AuditEvent[] }
  | { kind: "error" };

function isAuditEvent(value: unknown): value is AuditEvent {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "number" && typeof item.operationId === "string" &&
    typeof item.event === "string" && typeof item.timestamp === "string" &&
    typeof item.context === "object" && item.context !== null;
}

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

export default function AuditHistoryPage() {
  const { status } = useSession();
  const [state, setState] = useState<AuditState>({ kind: "loading" });

  useEffect(() => {
    if (status !== "authenticated") return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/audit/history", { signal: controller.signal });
        if (!response.ok) throw new Error("Audit history request failed");
        const payload: unknown = await response.json();
        if (typeof payload !== "object" || payload === null || !("events" in payload) ||
          !Array.isArray(payload.events) || !payload.events.every(isAuditEvent)) {
          throw new Error("Invalid audit history response");
        }
        setState({ kind: "ready", events: payload.events });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [status]);

  return (
    <main>
      <Link href="/dashboard" className="rounded-control font-mono text-sm text-subtle transition-colors hover:text-rose focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose">← Dashboard</Link>
      <h1 className="mt-6 text-2xl font-bold text-fg">Audit history</h1>
      <p className="mt-2 text-sm text-subtle">Recent sanitized operation events retained for 90 days.</p>
      <div className="mt-8" aria-live="polite">
        {status === "loading" || state.kind === "loading" ? (
          <p className="font-mono text-sm text-subtle">Loading audit history...</p>
        ) : status === "unauthenticated" ? (
          <EmptyState title="Sign in to view your audit history." />
        ) : state.kind === "error" ? (
          <p className="rounded-panel border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">Unable to load audit history. Please try again later.</p>
        ) : state.events.length === 0 ? (
          <EmptyState title="No audit events recorded yet." />
        ) : (
          <div className="overflow-x-auto rounded-card border border-line bg-surface-2 mask-r-from-85% md:mask-none">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface font-mono text-xs uppercase tracking-wider text-muted"><tr>
                <th scope="col" className="p-3 font-medium">When</th>
                <th scope="col" className="p-3 font-medium">Event</th>
                <th scope="col" className="p-3 font-medium">Operation</th>
              </tr></thead>
              <tbody>{state.events.map((event) => (
                <tr key={event.id} className="border-t border-line-soft text-dim transition-colors hover:bg-glass">
                  <td className="whitespace-nowrap p-3 font-mono text-xs text-subtle">{formatTimestamp(event.timestamp)}</td>
                  <td className="p-3 font-mono text-sky">{event.event}</td>
                  <td className="p-3 font-mono text-xs text-subtle">{event.operationId}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
