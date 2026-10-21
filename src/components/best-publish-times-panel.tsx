"use client";

import { useEffect, useState } from "react";
import type { BestPublishTimesResponse } from "@/lib/youtube-best-publish-times/contracts";
import {
  bestPublishTimesErrorMessage,
  toBestPublishTimesView,
  type BestPublishTimesView,
} from "@/lib/youtube-best-publish-times/presentation";
import { cn } from "@/lib/cn";
import { Badge, Card, EmptyState } from "@/components/ui";

type BestPublishTimesFetcher = (url: string) => Promise<Response>;

const defaultFetcher: BestPublishTimesFetcher = (url) => fetch(url);

export async function requestBestPublishTimes(
  timezone: string,
  fetcher: BestPublishTimesFetcher = defaultFetcher,
): Promise<BestPublishTimesView> {
  const query = new URLSearchParams({ timezone });
  try {
    const response = await fetcher(`/api/youtube/best-publish-times?${query}`);
    const body = (await response.json()) as BestPublishTimesResponse;
    if (!response.ok && body.kind !== "best-publish-times-error") {
      return { kind: "error", message: bestPublishTimesErrorMessage(undefined) };
    }
    return toBestPublishTimesView(body);
  } catch {
    return { kind: "error", message: bestPublishTimesErrorMessage(undefined) };
  }
}

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function BestPublishTimesContent({
  view,
  timezone,
  loading,
}: {
  view: BestPublishTimesView | null;
  timezone: string | null;
  loading: boolean;
}) {
  const result = view?.kind === "result" ? view : null;
  const shownTimezone = result?.timezone ?? timezone;
  return (
    <>
      {shownTimezone && (
        <p className="text-sm text-subtle">
          Times shown in <span className="font-mono font-medium text-sky">{shownTimezone}</span>.
        </p>
      )}

      {loading && <p role="status" className="font-mono text-sm text-subtle">Loading best publish times...</p>}
      {!loading && view?.kind === "error" && <p role="alert" className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{view.message}</p>}

      {!loading && result && (
        <>
          {result.confidenceNotice && (
            <p role="note" className="rounded-panel border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
              {result.confidenceNotice}
            </p>
          )}
          {result.slots.length ? (
            <ol className="grid gap-3 sm:grid-cols-3">
              {result.slots.map((slot) => (
                <li
                  key={slot.rank}
                  className={cn(
                    "rounded-panel border bg-surface p-4",
                    slot.rank === 1 ? "border-rose/40 shadow-glow" : "border-line",
                  )}
                >
                  <Badge tone={slot.rank === 1 ? "rose" : "neutral"}>#{slot.rank}</Badge>
                  <p className="mt-3 font-mono text-lg font-semibold text-fg">{slot.label}</p>
                  <p className="mt-1 font-mono text-xs text-subtle">{slot.scoreLabel} · {slot.sampleLabel}</p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title={result.emptyMessage} />
          )}
          <p className="font-mono text-xs text-muted">{result.countsLabel}</p>
        </>
      )}

      <div className="rounded-panel border border-line-soft bg-glass p-4 text-xs leading-relaxed text-subtle">
        <p className="font-mono font-medium uppercase tracking-wider text-dim">How this is calculated</p>
        <p className="mt-1">
          Based on your channel&apos;s last 50 uploads (videos younger than 4 days are excluded). Each video&apos;s views in
          its first 3 days are compared with your channel median, grouped by weekday and 3-hour block. A slot needs at
          least 2 videos to be recommended.
        </p>
        <p className="mt-1">
          This is an estimate from past performance, not live data on when your audience is online. TubeMaster never
          publishes or schedules anything from this panel.
        </p>
      </div>
    </>
  );
}

export function BestPublishTimesPanel({
  fetcher = defaultFetcher,
  timezone,
}: {
  fetcher?: BestPublishTimesFetcher;
  timezone?: string;
} = {}) {
  const [loaded, setLoaded] = useState<{ view: BestPublishTimesView; timezone: string } | null>(null);

  useEffect(() => {
    let active = true;
    // Resolved on the client so server rendering never shows the server's timezone.
    const requested = timezone ?? browserTimezone();
    void requestBestPublishTimes(requested, fetcher).then((view) => {
      if (active) setLoaded({ view, timezone: requested });
    });
    return () => {
      active = false;
    };
  }, [fetcher, timezone]);

  return (
    <Card aria-labelledby="best-publish-times-heading" className="space-y-4">
      <div>
        <h2 id="best-publish-times-heading" className="text-xl font-semibold text-fg">Best publish times</h2>
        <p className="mt-1 text-sm text-subtle">Weekday and time slots where your past uploads got the most early views.</p>
      </div>
      <BestPublishTimesContent view={loaded?.view ?? null} timezone={loaded?.timezone ?? timezone ?? null} loading={!loaded} />
    </Card>
  );
}
