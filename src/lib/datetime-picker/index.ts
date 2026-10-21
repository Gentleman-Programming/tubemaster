import { toUnambiguousUtc } from "@/lib/video-scheduling/schemas";
import type { PublishSlot, Weekday } from "@/lib/youtube-best-publish-times/contracts";

/** A picked moment as the queue API expects it: local wall time (`YYYY-MM-DDTHH:mm:ss`) plus an IANA timezone. */
export type PickerValue = { localDateTime: string; timezone: string };

/** Recommended hours (0-23, local to the slots' timezone) per weekday. */
export type SlotHighlights = Map<Weekday, Set<number>>;

export type PickerDay = {
  /** `YYYY-MM-DD` in the picker timezone. */
  key: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  recommended: boolean;
};

export type PickerMonth = { year: number; month: number; weeks: PickerDay[][] };
export type TimeOption = { value: string; disabled: boolean; recommended: boolean };
export type PickerContext = { now: Date; timezone: string; highlights?: SlotHighlights };

const WEEKDAYS: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_MS = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const TIME_STEP_MINUTES = 15;
export const TIME_OPTIONS: readonly string[] = Array.from({ length: (24 * 60) / TIME_STEP_MINUTES }, (_, index) => {
  const minutes = index * TIME_STEP_MINUTES;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
});

export const COMMON_TIMEZONES: readonly string[] = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function keyFromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayMs(key: string): number | null {
  const match = DATE_PATTERN.exec(key);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return keyFromUtcMs(ms) === key ? ms : null;
}

export function isTimezone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Current local date and minute in the timezone. */
export function zonedNow(now: Date, timezone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map(({ type, value }) => [type, value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function weekdayOf(key: string): Weekday {
  const ms = dayMs(key) ?? 0;
  return WEEKDAYS[(new Date(ms).getUTCDay() + 6) % 7];
}

export function composeLocalDateTime(date: string, time: string): string | null {
  if (dayMs(date) === null || !TIME_PATTERN.test(time)) return null;
  return `${date}T${time}:00`;
}

/** Accepts `YYYY-MM-DDTHH:mm` (calendar links) or `YYYY-MM-DDTHH:mm:ss` (queue API). */
export function parseLocalDateTime(value: string): { date: string; time: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::00)?$/.exec(value);
  if (!match || !composeLocalDateTime(match[1], match[2])) return null;
  return { date: match[1], time: match[2] };
}

export type LocalDateTimeCheck = { ok: true; utc: string } | { ok: false; message: string };

/** Rejects unknown zones, malformed values, DST gaps/folds and, when `now` is given, times that are not in the future. */
export function validateLocalDateTime(localDateTime: string, timezone: string, now?: Date): LocalDateTimeCheck {
  if (!isTimezone(timezone)) return { ok: false, message: "Choose a valid timezone." };
  const parsed = parseLocalDateTime(localDateTime);
  if (!parsed) return { ok: false, message: "Choose a valid date and time." };
  const utc = toUnambiguousUtc(`${parsed.date}T${parsed.time}:00`, timezone);
  if (!utc) {
    return { ok: false, message: `This time does not exist or is ambiguous in ${timezone} because of a daylight saving change. Choose another time.` };
  }
  if (now && Date.parse(utc) <= now.getTime()) return { ok: false, message: "Choose a future time." };
  return { ok: true, utc };
}

export function bestSlotHighlights(slots: readonly Pick<PublishSlot, "weekday" | "startHour" | "endHour">[]): SlotHighlights {
  const highlights: SlotHighlights = new Map();
  for (const slot of slots) {
    if (!WEEKDAYS.includes(slot.weekday)) continue;
    const hours = highlights.get(slot.weekday) ?? new Set<number>();
    for (let hour = Math.max(0, slot.startHour); hour < Math.min(24, slot.endHour); hour++) hours.add(hour);
    if (hours.size) highlights.set(slot.weekday, hours);
  }
  return highlights;
}

export function buildPickerMonth(year: number, month: number, context: PickerContext): PickerMonth {
  const today = zonedNow(context.now, context.timezone).date;
  const first = Date.UTC(year, month - 1, 1);
  const last = Date.UTC(year, month, 0);
  const start = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS;
  const end = last + ((7 - new Date(last).getUTCDay()) % 7) * DAY_MS;
  const weeks: PickerDay[][] = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    if ((ms - start) % (7 * DAY_MS) === 0) weeks.push([]);
    const date = new Date(ms);
    const key = keyFromUtcMs(ms);
    weeks[weeks.length - 1].push({
      key,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1,
      isToday: key === today,
      isPast: key < today,
      recommended: !!context.highlights?.get(weekdayOf(key))?.size,
    });
  }
  return { year, month, weeks };
}

export function shiftPickerMonth(current: { year: number; month: number }, delta: number): { year: number; month: number } {
  const index = current.year * 12 + current.month - 1 + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function offsetMinutes(instant: number, timezone: string): number {
  const local = zonedNow(new Date(instant), timezone);
  return Math.round((Date.parse(`${local.date}T${local.time}:00Z`) - Math.floor(instant / 60_000) * 60_000) / 60_000);
}

/** Time options for a day: past times and DST gaps/folds are disabled, best-slot hours are recommended. */
export function timeOptionsForDay(date: string, context: PickerContext): TimeOption[] {
  const today = zonedNow(context.now, context.timezone);
  const midnight = dayMs(date);
  // Offsets around the day; they differ only on a DST transition day.
  const offsets =
    midnight === null
      ? []
      : [...new Set([offsetMinutes(midnight - 14 * 3_600_000, context.timezone), offsetMinutes(midnight + DAY_MS + 14 * 3_600_000, context.timezone)])];
  const hours = context.highlights?.get(weekdayOf(date));
  return TIME_OPTIONS.map((value) => {
    const past = date < today.date || (date === today.date && value <= today.time);
    // Same rule as toUnambiguousUtc, checked only against the day's two offsets: zero matches is a gap, two a fold.
    const wall = Date.parse(`${date}T${value}:00Z`);
    const matches = offsets.filter((offset) => {
      const local = zonedNow(new Date(wall - offset * 60_000), context.timezone);
      return `${local.date}T${local.time}` === `${date}T${value}`;
    });
    const missing = offsets.length > 1 && matches.length !== 1;
    return { value, disabled: midnight === null || past || missing, recommended: !!hours?.has(Number(value.slice(0, 2))) };
  });
}

const DEFAULT_TIME = "09:00";

/** Time preselected when a day is picked: next free slot today, else the day's first best slot, else 09:00. */
export function defaultTimeForDay(date: string, context: PickerContext): string {
  const enabled = timeOptionsForDay(date, context).filter((option) => !option.disabled);
  if (date === zonedNow(context.now, context.timezone).date) return enabled[0]?.value ?? DEFAULT_TIME;
  return (
    enabled.find((option) => option.recommended)?.value ??
    enabled.find((option) => option.value >= DEFAULT_TIME)?.value ??
    DEFAULT_TIME
  );
}

/** The previous month is reachable only while it still has a day that is not in the past. */
export function canShowPreviousMonth(view: { year: number; month: number }, context: Pick<PickerContext, "now" | "timezone">): boolean {
  const lastOfPrevious = keyFromUtcMs(Date.UTC(view.year, view.month - 1, 0));
  return lastOfPrevious >= zonedNow(context.now, context.timezone).date;
}

export function timezoneOptions(current: string): string[] {
  return [...new Set([...(isTimezone(current) && !COMMON_TIMEZONES.includes(current) ? [current] : []), ...COMMON_TIMEZONES])];
}

/** Calendar links (`?at=&tz=`) prefill the composer only with a valid, future, unambiguous time. */
export function initialScheduleFromQuery(at: string | null, timezone: string | null, now: Date): PickerValue | null {
  if (!at || !timezone) return null;
  const parsed = parseLocalDateTime(at);
  if (!parsed) return null;
  const localDateTime = `${parsed.date}T${parsed.time}:00`;
  return validateLocalDateTime(localDateTime, timezone, now).ok ? { localDateTime, timezone } : null;
}

export function formatDayLabel(key: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(dayMs(key) ?? 0);
}

export function formatMonthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(Date.UTC(year, month - 1, 1));
}

export function formatUtcInstant(utc: string): string {
  return `${utc.slice(0, 10)} ${utc.slice(11, 16)} UTC`;
}

export function shiftDayKey(key: string, days: number): string {
  return keyFromUtcMs((dayMs(key) ?? 0) + days * DAY_MS);
}

export type BestSlotsFetcher = (url: string) => Promise<Response>;

/** Recommended slots for the timezone; any failure yields no highlights so the picker keeps working. */
export async function fetchBestSlots(timezone: string, fetcher: BestSlotsFetcher = (url) => fetch(url)): Promise<PublishSlot[]> {
  try {
    const response = await fetcher(`/api/youtube/best-publish-times?${new URLSearchParams({ timezone })}`);
    if (!response.ok) return [];
    const body = (await response.json()) as { kind?: string; slots?: unknown };
    if (body.kind !== "best-publish-times" || !Array.isArray(body.slots)) return [];
    return body.slots.filter(
      (slot): slot is PublishSlot =>
        typeof slot === "object" && slot !== null && WEEKDAYS.includes((slot as PublishSlot).weekday) &&
        Number.isInteger((slot as PublishSlot).startHour) && Number.isInteger((slot as PublishSlot).endHour),
    );
  } catch {
    return [];
  }
}
