import type { SocialPostStatus } from "../social/contracts";

export type CalendarSource = "tiktok" | "instagram" | "youtube";
export type CalendarItemStatus = SocialPostStatus | "youtube-scheduled";

/** One entry on the schedules calendar; `at` is a UTC ISO timestamp. */
export type CalendarItem = {
  id: string;
  source: CalendarSource;
  status: CalendarItemStatus;
  title: string;
  at: string;
  href?: string;
};

/** Calendar day as `YYYY-MM-DD`, always interpreted in the calendar timezone. */
export type DayKey = string;

export type MonthDay = {
  key: DayKey;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  /** Local `YYYY-MM-DDTHH:mm` suggested for a new post, or null when the day has no future time left. */
  slot: string | null;
  items: CalendarItem[];
};

export type MonthGrid = { year: number; month: number; weeks: MonthDay[][] };

export type WeekHour = {
  hour: number;
  localDateTime: string;
  /** UTC start of the hour, or null when the local hour does not exist (DST gap). */
  utc: string | null;
  exists: boolean;
  isPast: boolean;
  slot: string | null;
  items: CalendarItem[];
};

export type WeekDay = { key: DayKey; isToday: boolean; hours: WeekHour[] };

export type WeekView = { days: WeekDay[] };
