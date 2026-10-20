import type { EarlyViewsSample, PublishSlot, Weekday } from "./contracts";

const WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
// YouTube Analytics report days are Pacific-time calendar days.
const REPORT_TIMEZONE = "America/Los_Angeles";

export function isValidTimezone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function localSlot(
  publishedAt: string,
  timezone: string,
  slotHours = 3,
): { weekday: Weekday; startHour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(publishedAt));
  const weekday = parts.find((part) => part.type === "weekday")!.value.toLowerCase() as Weekday;
  const hour = Number(parts.find((part) => part.type === "hour")!.value);
  return { weekday, startHour: Math.floor(hour / slotHours) * slotHours };
}

export function earlyWindow(publishedAt: string): { startDate: string; endDate: string } {
  const startDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(publishedAt));
  const end = new Date(`${startDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  return { startDate, endDate: end.toISOString().slice(0, 10) };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function rankPublishSlots(
  samples: readonly EarlyViewsSample[],
  timezone: string,
  opts: { slotHours?: number; minSlotSamples?: number; maxSlots?: number } = {},
): { channelMedianEarlyViews: number; slots: PublishSlot[] } {
  const { slotHours = 3, minSlotSamples = 2, maxSlots = 3 } = opts;
  const channelMedianEarlyViews = median(samples.map((sample) => sample.earlyViews));
  if (channelMedianEarlyViews === 0) return { channelMedianEarlyViews, slots: [] };

  const groups = new Map<string, { weekday: Weekday; startHour: number; views: number[] }>();
  for (const sample of samples) {
    const { weekday, startHour } = localSlot(sample.publishedAt, timezone, slotHours);
    const key = `${weekday}-${startHour}`;
    const group = groups.get(key) ?? { weekday, startHour, views: [] };
    group.views.push(sample.earlyViews);
    groups.set(key, group);
  }

  const slots = [...groups.values()]
    .filter((group) => group.views.length >= minSlotSamples)
    .map((group): PublishSlot => {
      const medianEarlyViews = median(group.views);
      return {
        weekday: group.weekday,
        startHour: group.startHour,
        endHour: group.startHour + slotHours,
        score: Math.round((medianEarlyViews / channelMedianEarlyViews) * 100) / 100,
        sampleSize: group.views.length,
        medianEarlyViews,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.sampleSize - a.sampleSize ||
        WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) ||
        a.startHour - b.startHour,
    );
  return { channelMedianEarlyViews, slots: slots.slice(0, maxSlots) };
}
