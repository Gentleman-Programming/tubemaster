"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

type RunResult = {
  matched: number;
  results?: { video: string; playlist: string; rule: string }[];
  message?: string;
};

export function RunButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);

  async function handleRun() {
    setLoading(true);
    setResult(null);

    const res = await fetch("/api/run", { method: "POST" });
    const data = await res.json();
    setResult(data);
    setLoading(false);
  }

  return (
    <div>
      <Button onClick={handleRun} disabled={loading}>
        {loading ? "Running rules..." : "Run Rules Now"}
      </Button>

      {result && (
        <div className="mt-4 rounded-panel border border-line bg-surface-2 p-4">
          {result.matched === 0 ? (
            <p className="text-sm text-subtle">
              {result.message ?? "No videos matched any rules."}
            </p>
          ) : (
            <>
              <p className="mb-2 font-mono text-sm font-medium text-mint">
                {result.matched} video(s) matched and added!
              </p>
              <ul className="space-y-1 text-sm">
                {result.results?.map((r, i) => (
                  <li key={i} className="text-dim">
                    <span className="font-medium text-fg">{r.video}</span> → {r.playlist}{" "}
                    <span className="font-mono text-muted">(rule: {r.rule})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
