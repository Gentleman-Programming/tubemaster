import type { SocialPost } from "../social/contracts";
import type { ScheduledYoutubeVideo } from "../youtube-schedule-calendar/contracts";
import type { CalendarItem, DayKey, MonthDay, MonthGrid, WeekDay, WeekHour, WeekView } from "./contracts";

// Pure calendar math. Calendar days are handled as UTC dates so the host timezone never leaks in;
// only instants (item times, now) are converted through the calendar timezone.

const DAY_MS = 86_400_000;
const DEFAULT_SLOT_HOUR = 9;
const formatters = new Map<string, Intl.DateTimeFormat>();

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number };

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

function zonedParts(instant: number, timezone: string): ZonedParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timezone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return { year: values.year, month: values.month, day: values.day, hour: values.hour % 24, minute: values.minute };
}

const pad = (value: number) => String(value).padStart(2, "0");
const keyOf = (year: number, month: number, day: number): DayKey => `${year}-${pad(month)}-${pad(day)}`;
const dayToUtc = (key: DayKey) => Date.parse(`${key}T00:00:00Z`);
const utcToKey = (ms: number): DayKey => new Date(ms).toISOString().slice(0, 10);
const localDateTimeOf = (key: DayKey, hour: number) => `${key}T${pad(hour)}:00`;

function parseLocal(localDateTime: string): ZonedParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  return { year, month, day, hour, minute };
}

const wallClockMs = (parts: ZonedParts) => Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
const offsetAt = (instant: number, timezone: string) => wallClockMs(zonedParts(instant, timezone)) - Math.floor(instant / 60_000) * 60_000;

/** UTC milliseconds for a local `YYYY-MM-DDTHH:mm` in `timezone`, or null when that wall time does not exist. */
export function zonedTimeToUtc(localDateTime: string, timezone: string): number | null {
  const parts = parseLocal(localDateTime);
  if (!parts) return null;
  const wall = wallClockMs(parts);
  let utc = wall - offsetAt(wall, timezone);
  const corrected = wall - offsetAt(utc, timezone);
  if (corrected !== utc) utc = corrected;
  return wallClockMs(zonedParts(utc, timezone)) === wall ? utc : null;
}

export function todayKey(now: Date, timezone: string): DayKey {
  const parts = zonedParts(now.getTime(), timezone);
  return keyOf(parts.year, parts.month, parts.day);
}

export function shiftDays(key: DayKey, days: number): DayKey {
  return utcToKey(dayToUtc(key) + days * DAY_MS);
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Monday of the week containing `key`. */
export function startOfWeek(key: DayKey): DayKey {
  const weekday = new Date(dayToUtc(key)).getUTCDay(); // 0 = Sunday.
  return shiftDays(key, -((weekday + 6) % 7));
}

export function formatDayLabel(key: DayKey): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "full" }).format(dayToUtc(key));
}

export function formatHourLabel(key: DayKey, hour: number): string {
  return `${formatDayLabel(key)}, ${pad(hour)}:00`;
}

export function composerHref(localDateTime: string, timezone: string): string {
  return `/dashboard/social?at=${encodeURIComponent(localDateTime)}&tz=${encodeURIComponent(timezone)}`;
}

function compareItems(a: CalendarItem, b: CalendarItem): number {
  return Date.parse(a.at) - Date.parse(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function toIso(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Merges social posts (every status) and scheduled YouTube videos into time-ordered calendar items. */
export function toCalendarItems(posts: readonly SocialPost[], videos: readonly ScheduledYoutubeVideo[]): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const post of posts) {
    const at = toIso(post.scheduledAtUtc);
    if (!at) continue;
    items.push({ id: `social:${post.id}`, source: post.platform, status: post.status, title: post.caption.trim() || "(no caption)", at });
  }
  for (const video of videos) {
    const at = toIso(video.publishAt);
    if (!at) continue;
    items.push({
      id: `youtube:${video.videoId}`,
      source: "youtube",
      status: "youtube-scheduled",
      title: video.title.trim() || "(untitled video)",
      at,
      href: `https://studio.youtube.com/video/${encodeURIComponent(video.videoId)}/edit`,
    });
  }
  return items.sort(compareItems);
}

/** Groups items by local day and hour; items with an unreadable time are dropped. */
function bucketItems(items: readonly CalendarItem[], timezone: string): Map<string, CalendarItem[]> {
  const buckets = new Map<string, CalendarItem[]>();
  for (const entry of [...items].sort(compareItems)) {
    const ms = Date.parse(entry.at);
    if (!Number.isFinite(ms)) continue;
    const parts = zonedParts(ms, timezone);
    const bucketKey = `${keyOf(parts.year, parts.month, parts.day)}|${parts.hour}`;
    buckets.set(bucketKey, [...(buckets.get(bucketKey) ?? []), entry]);
  }
  return buckets;
}

function hoursOf(key: DayKey, timezone: string, now: Date, buckets: Map<string, CalendarItem[]>): WeekHour[] {
  const nowMs = now.getTime();
  return Array.from({ length: 24 }, (_, hour) => {
    const localDateTime = localDateTimeOf(key, hour);
    const utc = zonedTimeToUtc(localDateTime, timezone);
    // A skipped DST hour is past once the next hour has started.
    const start = utc ?? zonedTimeToUtc(localDateTimeOf(key, Math.min(hour + 1, 23)), timezone) ?? Number.POSITIVE_INFINITY;
    const isPast = start <= nowMs;
    return {
      hour,
      localDateTime,
      utc: utc === null ? null : new Date(utc).toISOString(),
      exists: utc !== null,
      isPast,
      slot: utc !== null && !isPast ? localDateTime : null,
      items: buckets.get(`${key}|${hour}`) ?? [],
    };
  });
}

export function buildMonthGrid(args: {
  year: number;
  month: number;
  timezone: string;
  now: Date;
  items: readonly CalendarItem[];
}): MonthGrid {
  const { year, month, timezone, now } = args;
  const today = todayKey(now, timezone);
  const buckets = bucketItems(args.items, timezone);
  const first = keyOf(year, month, 1);
  const next = shiftMonth(year, month, 1);
  const last = shiftDays(keyOf(next.year, next.month, 1), -1);
  const weeks: MonthDay[][] = [];
  for (let cursor = startOfWeek(first); cursor <= last; ) {
    const week: MonthDay[] = [];
    for (let index = 0; index < 7; index++, cursor = shiftDays(cursor, 1)) {
      const isPast = cursor < today;
      const futureHours = isPast
        ? []
        : hoursOf(cursor, timezone, now, new Map()).filter((hour) => hour.slot !== null && (cursor === today || hour.hour >= DEFAULT_SLOT_HOUR));
      week.push({
        key: cursor,
        day: Number(cursor.slice(8)),
        inMonth: cursor.slice(0, 7) === first.slice(0, 7),
        isToday: cursor === today,
        isPast,
        slot: futureHours[0]?.slot ?? null,
        items: Array.from({ length: 24 }, (_, hour) => buckets.get(`${cursor}|${hour}`) ?? []).flat(),
      });
    }
    weeks.push(week);
  }
  return { year, month, weeks };
}

/** `count` consecutive days from `start`, laid out like a week (used for narrow screens). */
export function buildDayRange(args: { start: DayKey; count: number; timezone: string; now: Date; items: readonly CalendarItem[] }): WeekView {
  const today = todayKey(args.now, args.timezone);
  const buckets = bucketItems(args.items, args.timezone);
  const days: WeekDay[] = Array.from({ length: args.count }, (_, index) => {
    const key = shiftDays(args.start, index);
    return { key, isToday: key === today, hours: hoursOf(key, args.timezone, args.now, buckets) };
  });
  return { days };
}

export function buildWeekView(args: { anchor: DayKey; timezone: string; now: Date; items: readonly CalendarItem[] }): WeekView {
  return buildDayRange({ ...args, start: startOfWeek(args.anchor), count: 7 });
}

export type SlotCell = { row: number; col: number };

/**
 * Roving focus between empty-slot cells (row-major order). Arrows move within the row or column to the
 * closest cell; Left/Right fall back to the previous/next cell in reading order. Returns null to stay put.
 */
export function nextSlotCell(cells: readonly SlotCell[], from: number, key: string): number | null {
  const current = cells[from];
  if (!current) return null;
  const indexed = cells.map((cell, index) => ({ ...cell, index }));
  const closest = (candidates: typeof indexed, distance: (cell: SlotCell) => number) =>
    candidates.sort((a, b) => distance(a) - distance(b))[0]?.index ?? null;
  const sameRow = indexed.filter((cell) => cell.row === current.row);
  switch (key) {
    case "ArrowRight":
      return from + 1 < cells.length ? from + 1 : null;
    case "ArrowLeft":
      return from > 0 ? from - 1 : null;
    case "ArrowDown":
      return closest(indexed.filter((cell) => cell.col === current.col && cell.row > current.row), (cell) => cell.row);
    case "ArrowUp":
      return closest(indexed.filter((cell) => cell.col === current.col && cell.row < current.row), (cell) => -cell.row);
    case "Home":
      return sameRow[0].index;
    case "End":
      return sameRow[sameRow.length - 1].index;
    default:
      return null;
  }
}
