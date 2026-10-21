"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { SocialPost } from "@/lib/social/contracts";
import {
  canCancelPost,
  canReschedulePost,
  formatScheduledLocal,
  formatScheduledUtc,
  platformChip,
  platformLabel,
  postStatusBadge,
  readApiError,
  toLocalDateTime,
  type SocialFetcher,
} from "@/lib/social/presentation";
import {
  buildMonthGrid,
  buildWeekView,
  composerHref,
  formatDayLabel,
  shiftDays,
  shiftMonth,
  startOfWeek,
  toCalendarItems,
  todayKey,
  type CalendarItem,
  type DayKey,
  type MonthGrid,
  type WeekView,
} from "@/lib/schedule-calendar";
import type { ScheduledYoutubeVideo } from "@/lib/youtube-schedule-calendar/contracts";
import { Badge, Button, buttonClasses, DateTimePicker, EmptyState, useBestPublishSlots } from "@/components/ui";
import { cn } from "@/lib/cn";
import { cancelSocialPost, requestSocialPosts, rescheduleSocialPost } from "./social-queue";
import {
  browserTimezone,
  confirmSocialPost,
  scheduleFields,
  schedulePickerValue,
  SocialPostPreviewCard,
  type SocialPostPreview,
} from "./social-composer";

export type CalendarData = { posts: SocialPost[]; videos: ScheduledYoutubeVideo[]; notice: string | null };
export type CalendarLoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: CalendarData };
export type CalendarMode = "month" | "week";

const defaultFetcher: SocialFetcher = (url, init) => fetch(url, init);
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_CHIP_LIMIT = 3;
const YOUTUBE_DOT = "bg-danger";
const YOUTUBE_TONE = "border-mauve/30 bg-mauve/10 text-mauve";

function youtubeNotice(code: string | undefined): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "Sign in again to see scheduled YouTube videos.";
    case "AUTH_SCOPE_INSUFFICIENT":
      return "Sign out and sign in again to grant YouTube read access (youtube.readonly) and see scheduled YouTube videos.";
    default:
      return "Scheduled YouTube videos could not be loaded. Social posts are still shown.";
  }
}

async function requestScheduledVideos(fetcher: SocialFetcher): Promise<{ videos: ScheduledYoutubeVideo[]; notice: string | null }> {
  try {
    const response = await fetcher("/api/youtube/scheduled");
    const body: unknown = await response.json().catch(() => null);
    const videos = (body as { videos?: unknown } | null)?.videos;
    if (response.ok && Array.isArray(videos)) return { videos: videos as ScheduledYoutubeVideo[], notice: null };
    return { videos: [], notice: youtubeNotice(readApiError(body).code) };
  } catch {
    return { videos: [], notice: youtubeNotice(undefined) };
  }
}

/** Social posts are required; scheduled YouTube videos degrade to a notice when unavailable. */
export async function loadCalendarData(fetcher: SocialFetcher = defaultFetcher): Promise<CalendarLoadState> {
  const [social, youtube] = await Promise.all([requestSocialPosts(fetcher), requestScheduledVideos(fetcher)]);
  if (social.kind === "error") return { kind: "error", message: social.message };
  return { kind: "ready", data: { posts: social.posts, videos: youtube.videos, notice: youtube.notice } };
}

function formatInZone(utcIso: string, timezone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", ...options }).format(Date.parse(utcIso));
}

function describeItem(item: CalendarItem) {
  if (item.source === "youtube") return { kind: "YouTube video", platform: "YouTube", status: "Scheduled on YouTube", dot: YOUTUBE_DOT, tone: YOUTUBE_TONE };
  const badge = postStatusBadge(item.status === "youtube-scheduled" ? "scheduled" : item.status);
  return { kind: `${platformLabel(item.source)} post`, platform: platformLabel(item.source), status: badge.label, dot: platformChip(item.source).dotClassName, tone: badge.className };
}

function itemLabel(item: CalendarItem, timezone: string): string {
  const { kind, status } = describeItem(item);
  return `${kind}, ${status}, ${formatInZone(item.at, timezone, { dateStyle: "full", timeStyle: "short" })}: ${item.title}`;
}

function ItemChip({ item, timezone, selected, onSelect }: { item: CalendarItem; timezone: string; selected: boolean; onSelect?: (item: CalendarItem) => void }) {
  const { dot, tone } = describeItem(item);
  return (
    <button
      type="button"
      aria-label={itemLabel(item, timezone)}
      aria-expanded={selected}
      aria-controls="calendar-item-detail"
      onClick={() => onSelect?.(item)}
      className={cn(
        "flex w-full min-w-0 items-center gap-1.5 rounded-control border px-1.5 py-0.5 text-left text-[11px] transition-colors hover:border-rose/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose",
        tone,
        selected && "ring-1 ring-rose",
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dot)} />
      <span className="shrink-0 font-mono">{formatInZone(item.at, timezone, { hour: "2-digit", minute: "2-digit" })}</span>
      <span className="truncate text-fg">{item.title}</span>
    </button>
  );
}

function NewPostLink({ slot, timezone, dayKey, className }: { slot: string; timezone: string; dayKey: DayKey; className?: string }) {
  return (
    <Link
      href={composerHref(slot, timezone)}
      aria-label={`New post on ${formatDayLabel(dayKey)} at ${slot.slice(11)}`}
      className={cn(
        "rounded-control px-1 font-mono text-[11px] text-muted transition-colors hover:bg-rose/10 hover:text-rose focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rose",
        className,
      )}
    >
      + new
    </Link>
  );
}

type GridProps = {
  timezone: string;
  selectedId: string | null;
  onSelect?: (item: CalendarItem) => void;
  onShowDay?: (key: DayKey) => void;
};

function MonthTable({ grid, timezone, selectedId, onSelect, onShowDay }: GridProps & { grid: MonthGrid }) {
  const title = formatInZone(`${grid.year}-${String(grid.month).padStart(2, "0")}-15T12:00:00Z`, "UTC", { month: "long", year: "numeric" });
  return (
    <table aria-label={title} className="w-full table-fixed border-collapse text-sm">
      <thead>
        <tr>
          {WEEKDAYS.map((weekday) => (
            <th key={weekday} scope="col" className="pb-2 text-left font-mono text-[11px] font-medium uppercase tracking-widest text-subtle">
              <span aria-hidden="true">{weekday.slice(0, 3)}</span>
              <span className="sr-only">{weekday}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.weeks.map((week) => (
          <tr key={week[0].key}>
            {week.map((day) => {
              const hidden = day.items.length - MONTH_CHIP_LIMIT;
              return (
                <td
                  key={day.key}
                  className={cn(
                    "h-28 border border-line-soft p-1.5 align-top",
                    !day.inMonth && "bg-glass text-muted",
                    day.isPast && "opacity-60",
                    day.isToday && "bg-rose/5",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-1">
                    <span
                      aria-current={day.isToday ? "date" : undefined}
                      className={cn("font-mono text-xs", day.isToday ? "rounded-full bg-rose px-1.5 text-canvas" : "text-dim")}
                    >
                      <span aria-hidden="true">{day.day}</span>
                      <span className="sr-only">{formatDayLabel(day.key)}</span>
                    </span>
                    {day.slot && <NewPostLink slot={day.slot} timezone={timezone} dayKey={day.key} />}
                  </div>
                  <div className="space-y-1">
                    {day.items.slice(0, MONTH_CHIP_LIMIT).map((item) => (
                      <ItemChip key={item.id} item={item} timezone={timezone} selected={selectedId === item.id} onSelect={onSelect} />
                    ))}
                    {hidden > 0 && (
                      <button
                        type="button"
                        onClick={() => onShowDay?.(day.key)}
                        className="font-mono text-[11px] text-rose hover:underline focus-visible:outline-2 focus-visible:outline-rose"
                      >
                        +{hidden} more
                      </button>
                    )}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WeekTable({ week, timezone, selectedId, onSelect }: GridProps & { week: WeekView }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-panel border border-line-soft">
      <table aria-label={`Week of ${formatDayLabel(week.days[0].key)}`} className="w-full min-w-[48rem] table-fixed border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            <th scope="col" className="w-16 p-2"><span className="sr-only">Hour</span></th>
            {week.days.map((day) => (
              <th key={day.key} scope="col" aria-current={day.isToday ? "date" : undefined} className={cn("p-2 text-left font-mono text-[11px] font-medium uppercase tracking-widest", day.isToday ? "text-rose" : "text-subtle")}>
                <span aria-hidden="true">{formatDayLabel(day.key).split(",")[0].slice(0, 3)} {Number(day.key.slice(8))}</span>
                <span className="sr-only">{formatDayLabel(day.key)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 24 }, (_, hour) => (
            <tr key={hour}>
              <th scope="row" className="border-t border-line-soft p-1 pr-2 text-right align-top font-mono text-[11px] font-normal text-muted">{`${String(hour).padStart(2, "0")}:00`}</th>
              {week.days.map((day) => {
                const cell = day.hours[hour];
                return (
                  <td key={day.key} className={cn("h-10 border border-line-soft p-1 align-top", cell.isPast && "bg-glass opacity-60", day.isToday && !cell.isPast && "bg-rose/5")}>
                    {!cell.exists ? (
                      <span className="font-mono text-[11px] text-muted" title="Skipped by daylight saving time">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">Skipped by daylight saving time</span>
                      </span>
                    ) : cell.items.length ? (
                      <div className="space-y-1">
                        {cell.items.map((item) => (
                          <ItemChip key={item.id} item={item} timezone={timezone} selected={selectedId === item.id} onSelect={onSelect} />
                        ))}
                      </div>
                    ) : (
                      cell.slot && <NewPostLink slot={cell.slot} timezone={timezone} dayKey={day.key} className="block h-full w-full opacity-0 hover:opacity-100 focus-visible:opacity-100" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pure calendar body: states, notice and the month or week table. */
export function ScheduleCalendarContent({
  state,
  mode,
  monthGrid,
  week,
  ...grid
}: GridProps & { state: CalendarLoadState; mode: CalendarMode; monthGrid: MonthGrid | null; week: WeekView | null }) {
  if (state.kind === "loading") return <p role="status" className="font-mono text-sm text-subtle">Loading schedules...</p>;
  if (state.kind === "error") return <p role="alert" className="text-sm text-danger">{state.message}</p>;
  const visible = mode === "month" ? (monthGrid?.weeks.flat().flatMap((day) => day.items) ?? []) : (week?.days.flatMap((day) => day.hours.flatMap((hour) => hour.items)) ?? []);
  return (
    <div className="space-y-3">
      {state.data.notice && <p role="note" className="rounded-control border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">{state.data.notice}</p>}
      {!visible.length && <EmptyState title="Nothing scheduled in this period." description="Pick a future day or hour to create a post." className="py-4" />}
      <div className="overflow-x-auto">
        {mode === "month" && monthGrid && <MonthTable grid={monthGrid} {...grid} />}
        {mode === "week" && week && <WeekTable week={week} {...grid} />}
      </div>
    </div>
  );
}

const termClass = "font-mono text-xs uppercase tracking-widest text-subtle";

/** Details for one calendar item; social posts get reschedule and cancel, YouTube videos stay read-only. */
export function CalendarItemDetail({
  item,
  post,
  timezone,
  busy,
  onReschedule,
  onCancel,
  onClose,
  children,
}: {
  item: CalendarItem;
  post?: SocialPost;
  timezone: string;
  busy: boolean;
  onReschedule?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const { platform, status, dot } = describeItem(item);
  const badge = post ? postStatusBadge(post.status) : null;
  return (
    <section id="calendar-item-detail" aria-label="Schedule details" className="space-y-4 rounded-panel border border-line bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {badge ? <Badge tone={badge.tone} className={badge.modifier}>{badge.label}</Badge> : <Badge className={YOUTUBE_TONE}>{status}</Badge>}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-glass-2 px-2 py-0.5 text-xs font-medium text-fg">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", dot)} />
          {platform}
        </span>
        {onClose && <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>Close</Button>}
      </div>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <dt className={termClass}>{post ? "Caption" : "Title"}</dt>
        <dd className="whitespace-pre-wrap break-words text-fg">{post ? post.caption : item.title}</dd>
        <dt className={termClass}>Local</dt>
        <dd className="font-mono text-fg">{formatScheduledLocal(item.at, timezone)}</dd>
        <dt className={termClass}>UTC</dt>
        <dd className="font-mono text-xs text-subtle"><time dateTime={item.at}>{formatScheduledUtc(item.at)}</time></dd>
      </dl>
      {badge && <p className="text-xs text-subtle">{badge.description}</p>}
      {post?.error && (post.status === "failed" || post.status === "missed") && (
        <p className="rounded-control border border-danger/30 bg-danger/10 px-3 py-2 text-danger">{post.error.message}</p>
      )}
      {item.source === "youtube" ? (
        <p className="flex flex-wrap items-center gap-3 text-xs text-subtle">
          Read-only here: YouTube publishes this private video at its scheduled time.
          {item.href && (
            <a href={item.href} target="_blank" rel="noreferrer" className={buttonClasses("secondary", "sm")}>Open in YouTube Studio</a>
          )}
        </p>
      ) : (
        post && (canReschedulePost(post.status) || canCancelPost(post.status)) && (
          <div className="flex flex-wrap gap-2">
            {canReschedulePost(post.status) && <Button variant="secondary" size="sm" disabled={busy} onClick={onReschedule}>Reschedule</Button>}
            {canCancelPost(post.status) && <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel post</Button>}
          </div>
        )
      )}
      {children}
    </section>
  );
}

type RescheduleState = { date: string; time: string; timezone: string; preview: SocialPostPreview | null };

export function ScheduleCalendar({ fetcher = defaultFetcher }: { fetcher?: SocialFetcher } = {}) {
  const [clock, setClock] = useState<{ timezone: string; now: Date } | null>(null);
  const [state, setState] = useState<CalendarLoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState<DayKey | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState<RescheduleState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const bestSlots = useBestPublishSlots(reschedule?.timezone || null, !!reschedule && !reschedule.preview, fetcher);

  useEffect(() => {
    setClock({ timezone: browserTimezone(), now: new Date() });
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    void loadCalendarData(fetcher).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [fetcher, reloadKey]);

  if (!clock) return <ScheduleCalendarContent state={{ kind: "loading" }} mode={mode} monthGrid={null} week={null} timezone="UTC" selectedId={null} />;

  const { timezone, now } = clock;
  const today = todayKey(now, timezone);
  const current = anchor ?? today;
  const year = Number(current.slice(0, 4));
  const month = Number(current.slice(5, 7));
  const data = state.kind === "ready" ? state.data : null;
  const items = data ? toCalendarItems(data.posts, data.videos) : [];
  const monthGrid = mode === "month" ? buildMonthGrid({ year, month, timezone, now, items }) : null;
  const week = mode === "week" ? buildWeekView({ anchor: current, timezone, now, items }) : null;
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const selectedPost = selected && data ? data.posts.find((post) => `social:${post.id}` === selected.id) : undefined;
  const title = week
    ? `Week of ${formatDayLabel(startOfWeek(current)).split(", ").slice(1).join(", ")}`
    : formatInZone(`${current.slice(0, 7)}-15T12:00:00Z`, "UTC", { month: "long", year: "numeric" });

  function navigate(delta: number) {
    if (mode === "week") return setAnchor(shiftDays(current, delta * 7));
    const next = shiftMonth(year, month, delta);
    setAnchor(`${next.year}-${String(next.month).padStart(2, "0")}-01`);
  }

  function refresh() {
    setReloadKey((key) => key + 1);
  }

  async function cancel(post: SocialPost) {
    if (!window.confirm(`Cancel this ${platformLabel(post.platform)} post? It will not be published.`)) return;
    setBusy(true);
    const result = await cancelSocialPost(post.id, fetcher);
    setBusy(false);
    setMessage(result.ok ? "Post cancelled." : result.message);
    setReschedule(null);
    refresh();
  }

  async function previewReschedule(post: SocialPost, draft: RescheduleState) {
    const localDateTime = toLocalDateTime(draft.date, draft.time);
    if (!localDateTime) return setMessage("Enter a valid date and time.");
    setBusy(true);
    const result = await rescheduleSocialPost(post.id, { mode: "at", localDateTime, timezone: draft.timezone }, fetcher);
    setBusy(false);
    if (!result.ok) return setMessage(result.message);
    setMessage("");
    setReschedule({ ...draft, preview: result.body });
  }

  async function confirmReschedule(post: SocialPost, preview: SocialPostPreview) {
    setBusy(true);
    const result = await confirmSocialPost(post.id, preview.confirmationToken, fetcher);
    setBusy(false);
    setMessage(result.ok ? "New time confirmed." : `${result.message} The post stays a draft until it is confirmed.`);
    setReschedule(null);
    refresh();
  }

  function renderReschedule(post: SocialPost) {
    if (!reschedule) return null;
    if (reschedule.preview) {
      return (
        <SocialPostPreviewCard
          preview={reschedule.preview}
          displayTimezone={timezone}
          busy={busy}
          onConfirm={() => reschedule.preview && void confirmReschedule(post, reschedule.preview)}
          onBack={() => {
            setReschedule(null);
            setMessage("The post stays a draft until it is confirmed. Cancel it if you no longer want it.");
            refresh();
          }}
        />
      );
    }
    return (
      <form noValidate className="space-y-3 rounded-panel border border-line bg-glass p-3" onSubmit={(event) => { event.preventDefault(); void previewReschedule(post, reschedule); }}>
        <p className="text-xs text-subtle">Rescheduling returns the post to draft until you confirm the new time.</p>
        <DateTimePicker
          label="New publish date"
          timeLabel="New publish time"
          value={schedulePickerValue(reschedule.date, reschedule.time, reschedule.timezone)}
          timezone={reschedule.timezone || undefined}
          onTimezoneChange={(timezone) => setReschedule({ ...reschedule, timezone })}
          onChange={(value) => setReschedule({ ...reschedule, ...scheduleFields(value) })}
          bestSlots={bestSlots}
          disabled={busy}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy}>Preview new time</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReschedule(null)}>Close</Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" aria-label={`Previous ${mode}`} onClick={() => navigate(-1)}>‹</Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(null)}>Today</Button>
          <Button variant="secondary" size="sm" aria-label={`Next ${mode}`} onClick={() => navigate(1)}>›</Button>
          <h2 aria-live="polite" className="ml-1 text-lg font-semibold text-fg">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted">{timezone}</span>
          <div role="group" aria-label="Calendar view" className="flex gap-1 rounded-control border border-line bg-glass p-0.5">
            {(["month", "week"] as const).map((option) => (
              <Button key={option} variant={mode === option ? "primary" : "ghost"} size="sm" aria-pressed={mode === option} onClick={() => setMode(option)} className="capitalize">
                {option}
              </Button>
            ))}
          </div>
          <Button variant="secondary" size="sm" disabled={state.kind === "loading"} onClick={refresh}>Refresh</Button>
        </div>
      </div>
      <ScheduleCalendarContent
        state={state}
        mode={mode}
        monthGrid={monthGrid}
        week={week}
        timezone={timezone}
        selectedId={selectedId}
        onSelect={(item) => {
          setSelectedId(item.id === selectedId ? null : item.id);
          setReschedule(null);
        }}
        onShowDay={(key) => {
          setAnchor(key);
          setMode("week");
        }}
      />
      {selected && (
        <CalendarItemDetail
          item={selected}
          post={selectedPost ?? undefined}
          timezone={timezone}
          busy={busy}
          onClose={() => {
            setSelectedId(null);
            setReschedule(null);
          }}
          onCancel={() => selectedPost && void cancel(selectedPost)}
          onReschedule={() =>
            selectedPost &&
            setReschedule({ date: "", time: "", timezone: selectedPost.timezone === "UTC" ? timezone : selectedPost.timezone, preview: null })
          }
        >
          {selectedPost && renderReschedule(selectedPost)}
        </CalendarItemDetail>
      )}
      <p role="status" aria-live="polite" className="text-sm text-dim">{message}</p>
    </div>
  );
}
