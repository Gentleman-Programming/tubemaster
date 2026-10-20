"use client";

import { useEffect, useState } from "react";
import type { BestPublishTimesResponse } from "@/lib/youtube-best-publish-times/contracts";
import {
  bestPublishTimesErrorMessage,
  toBestPublishTimesView,
  type BestPublishTimesView,
} from "@/lib/youtube-best-publish-times/presentation";

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
        <p className="text-sm text-zinc-400">
          Times shown in <span className="font-medium text-zinc-200">{shownTimezone}</span>.
        </p>
      )}

      {loading && <p role="status" className="text-sm text-zinc-400">Loading best publish times...</p>}
      {!loading && view?.kind === "error" && <p role="alert" className="text-sm text-red-300">{view.message}</p>}

      {!loading && result && (
        <>
          {result.confidenceNotice && (
            <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              {result.confidenceNotice}
            </p>
          )}
          {result.slots.length ? (
            <ol className="grid gap-3 sm:grid-cols-3">
              {result.slots.map((slot) => (
                <li key={slot.rank} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">#{slot.rank}</p>
                  <p className="mt-1 text-lg font-semibold text-white">{slot.label}</p>
                  <p className="mt-1 text-xs text-zinc-400">{slot.scoreLabel} · {slot.sampleLabel}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-zinc-400">{result.emptyMessage}</p>
          )}
          <p className="text-xs text-zinc-500">{result.countsLabel}</p>
        </>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-400">
        <p className="font-medium text-zinc-300">How this is calculated</p>
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
    <section aria-labelledby="best-publish-times-heading" className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <div>
        <h2 id="best-publish-times-heading" className="text-xl font-semibold">Best publish times</h2>
        <p className="mt-1 text-sm text-zinc-400">Weekday and time slots where your past uploads got the most early views.</p>
      </div>
      <BestPublishTimesContent view={loaded?.view ?? null} timezone={loaded?.timezone ?? timezone ?? null} loading={!loaded} />
    </section>
  );
}
