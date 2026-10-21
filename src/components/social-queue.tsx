"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { SocialPost } from "@/lib/social/contracts";
import {
  callSocialApi,
  canCancelPost,
  canReschedulePost,
  formatScheduledLocal,
  formatScheduledUtc,
  platformLabel,
  postStatusBadge,
  toLocalDateTime,
  type SocialApiResult,
  type SocialFetcher,
} from "@/lib/social/presentation";
import {
  browserTimezone,
  confirmSocialPost,
  inputClass,
  secondaryButtonClass,
  SocialPostPreviewCard,
  type SocialPostPreview,
  type SocialSchedule,
} from "./social-composer";

export type SocialQueueView = { kind: "result"; posts: SocialPost[] } | { kind: "error"; message: string };

const defaultFetcher: SocialFetcher = (url, init) => fetch(url, init);
const postUrl = (postId: string, action: string) => `/api/social/posts/${encodeURIComponent(postId)}/${action}`;

export async function requestSocialPosts(fetcher: SocialFetcher = defaultFetcher): Promise<SocialQueueView> {
  const result = await callSocialApi<SocialPost[]>(fetcher, "/api/social/posts");
  if (!result.ok) return { kind: "error", message: result.message };
  return { kind: "result", posts: Array.isArray(result.body) ? result.body : [] };
}

export function cancelSocialPost(postId: string, fetcher: SocialFetcher = defaultFetcher): Promise<SocialApiResult<SocialPost>> {
  return callSocialApi<SocialPost>(fetcher, postUrl(postId, "cancel"), { method: "POST" });
}

/** Returns the post to draft with a new preview; the new time needs its own confirmation (S4). */
export function rescheduleSocialPost(
  postId: string,
  schedule: SocialSchedule,
  fetcher: SocialFetcher = defaultFetcher,
): Promise<SocialApiResult<SocialPostPreview>> {
  return callSocialApi<SocialPostPreview>(fetcher, postUrl(postId, "reschedule"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schedule }),
  });
}

export function SocialQueueContent({
  view,
  loading,
  busyPostId,
  onCancel,
  onReschedule,
  renderReschedule,
}: {
  view: SocialQueueView | null;
  loading: boolean;
  busyPostId?: string | null;
  onCancel?: (post: SocialPost) => void;
  onReschedule?: (post: SocialPost) => void;
  /** Inline reschedule editor for the post being rescheduled, if any. */
  renderReschedule?: (post: SocialPost) => ReactNode;
}) {
  if (loading) return <p role="status" className="text-sm text-zinc-400">Loading posts...</p>;
  if (view?.kind === "error") return <p role="alert" className="text-sm text-red-300">{view.message}</p>;
  const posts = view?.posts ?? [];
  if (!posts.length) return <p className="text-sm text-zinc-400">No posts yet. Previewed and scheduled posts appear here.</p>;
  return (
    <ul className="space-y-3">
      {posts.map((post) => {
        const badge = postStatusBadge(post.status);
        const busy = busyPostId === post.id;
        return (
          <li key={post.id} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
              <span className="font-medium text-white">{platformLabel(post.platform)}</span>
              <span className="text-zinc-400">{formatScheduledLocal(post.scheduledAtUtc, post.timezone)}</span>
              <time dateTime={post.scheduledAtUtc} className="text-xs text-zinc-500">{formatScheduledUtc(post.scheduledAtUtc)}</time>
            </div>
            <p className="line-clamp-2 whitespace-pre-wrap break-words text-zinc-300">{post.caption}</p>
            <p className="text-xs text-zinc-500">{badge.description}</p>
            {post.error && (post.status === "failed" || post.status === "missed") && (
              <p className="text-sm text-red-300">{post.error.message}</p>
            )}
            {(canCancelPost(post.status) || canReschedulePost(post.status)) && (
              <div className="flex flex-wrap gap-2">
                {canReschedulePost(post.status) && (
                  <button type="button" disabled={busy} onClick={() => onReschedule?.(post)} className={secondaryButtonClass}>Reschedule</button>
                )}
                {canCancelPost(post.status) && (
                  <button type="button" disabled={busy} onClick={() => onCancel?.(post)} className={secondaryButtonClass}>Cancel</button>
                )}
              </div>
            )}
            {renderReschedule?.(post)}
          </li>
        );
      })}
    </ul>
  );
}

type RescheduleState = {
  post: SocialPost;
  date: string;
  time: string;
  timezone: string;
  preview: SocialPostPreview | null;
};

export function SocialQueue({ fetcher = defaultFetcher, refreshKey = 0 }: { fetcher?: SocialFetcher; refreshKey?: number } = {}) {
  const [view, setView] = useState<SocialQueueView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [reschedule, setReschedule] = useState<RescheduleState | null>(null);
  const [localTimezone, setLocalTimezone] = useState("UTC");

  async function refresh() {
    setLoading(true);
    setView(await requestSocialPosts(fetcher));
    setLoading(false);
  }

  useEffect(() => {
    setLocalTimezone(browserTimezone());
  }, []);

  useEffect(() => {
    let active = true;
    void requestSocialPosts(fetcher).then((next) => {
      if (!active) return;
      setView(next);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fetcher, refreshKey]);

  async function cancel(post: SocialPost) {
    if (!window.confirm(`Cancel this ${platformLabel(post.platform)} post? It will not be published.`)) return;
    setBusyPostId(post.id);
    const result = await cancelSocialPost(post.id, fetcher);
    setMessage(result.ok ? "Post cancelled." : result.message);
    setBusyPostId(null);
    if (reschedule?.post.id === post.id) setReschedule(null);
    await refresh();
  }

  async function previewReschedule(state: RescheduleState) {
    const localDateTime = toLocalDateTime(state.date, state.time);
    if (!localDateTime) {
      setMessage("Enter a valid date and time.");
      return;
    }
    setBusyPostId(state.post.id);
    const result = await rescheduleSocialPost(state.post.id, { mode: "at", localDateTime, timezone: state.timezone }, fetcher);
    setBusyPostId(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage("");
    setReschedule({ ...state, preview: result.body });
    await refresh();
  }

  async function confirmReschedule(state: RescheduleState) {
    if (!state.preview) return;
    setBusyPostId(state.post.id);
    const result = await confirmSocialPost(state.post.id, state.preview.confirmationToken, fetcher);
    setBusyPostId(null);
    // On failure the post stays a draft: it can be cancelled, or composed again.
    setMessage(result.ok ? "New time confirmed." : `${result.message} The post stays a draft until it is confirmed.`);
    setReschedule(null);
    await refresh();
  }

  function renderReschedule(post: SocialPost) {
    if (reschedule?.post.id !== post.id) return null;
    const busy = busyPostId === post.id;
    if (reschedule.preview) {
      return (
        <SocialPostPreviewCard
          preview={reschedule.preview}
          displayTimezone={localTimezone}
          busy={busy}
          onConfirm={() => void confirmReschedule(reschedule)}
          onBack={() => {
            setReschedule(null);
            setMessage("The post stays a draft until it is confirmed. Cancel it if you no longer want it.");
          }}
        />
      );
    }
    return (
      <form
        noValidate
        className="space-y-2 rounded-lg border border-zinc-700 p-3"
        onSubmit={(event) => { event.preventDefault(); void previewReschedule(reschedule); }}
      >
        <p className="text-xs text-zinc-400">Rescheduling returns the post to draft until you confirm the new time.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <input type="date" aria-label="New publish date" value={reschedule.date} onChange={(event) => setReschedule({ ...reschedule, date: event.target.value })} disabled={busy} className={inputClass} />
          <input type="time" aria-label="New publish time" value={reschedule.time} onChange={(event) => setReschedule({ ...reschedule, time: event.target.value })} disabled={busy} className={inputClass} />
          <input type="text" aria-label="IANA timezone" value={reschedule.timezone} onChange={(event) => setReschedule({ ...reschedule, timezone: event.target.value })} disabled={busy} className={inputClass} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={secondaryButtonClass}>Preview new time</button>
          <button type="button" disabled={busy} onClick={() => setReschedule(null)} className={secondaryButtonClass}>Close</button>
        </div>
      </form>
    );
  }

  return (
    <section aria-labelledby="social-queue-heading" className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="social-queue-heading" className="text-xl font-semibold">Post queue</h2>
          <p className="mt-1 text-sm text-zinc-400">Scheduled posts are published only while the app is running.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => void refresh()} className={secondaryButtonClass}>Refresh</button>
      </div>
      <SocialQueueContent
        view={view}
        loading={loading && !view}
        busyPostId={busyPostId}
        onCancel={(post) => void cancel(post)}
        onReschedule={(post) => setReschedule({ post, date: "", time: "", timezone: post.timezone === "UTC" ? localTimezone : post.timezone, preview: null })}
        renderReschedule={renderReschedule}
      />
      <p role="status" aria-live="polite" className="text-sm text-zinc-300">{message}</p>
    </section>
  );
}
