import assert from "node:assert/strict";
import test from "node:test";
import type { PublishSlot } from "@/lib/youtube-best-publish-times/contracts";
import {
  bestSlotHighlights,
  buildPickerMonth,
  canShowPreviousMonth,
  composeLocalDateTime,
  defaultTimeForDay,
  fetchBestSlots,
  initialScheduleFromQuery,
  parseLocalDateTime,
  shiftPickerMonth,
  TIME_OPTIONS,
  timeOptionsForDay,
  timezoneOptions,
  validateLocalDateTime,
  weekdayOf,
  zonedNow,
} from "..";

const now = new Date("2026-10-21T15:20:00.000Z");
const slot = (weekday: PublishSlot["weekday"], startHour: number, endHour: number, score = 1.5): PublishSlot => ({
  weekday,
  startHour,
  endHour,
  score,
  sampleSize: 4,
  medianEarlyViews: 100,
});

test("builds a Monday-first month grid with leading and trailing days", () => {
  const grid = buildPickerMonth(2026, 10, { now, timezone: "UTC" });
  assert.equal(grid.weeks.length, 5);
  for (const week of grid.weeks) assert.equal(week.length, 7);
  // October 1st 2026 is a Thursday: Monday Sep 28 leads the first week.
  assert.deepEqual(grid.weeks[0].map((day) => day.key), [
    "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  ]);
  assert.equal(grid.weeks[0][0].inMonth, false);
  assert.equal(grid.weeks[0][3].inMonth, true);
  assert.equal(grid.weeks[4][6].key, "2026-11-01");
  assert.equal(grid.weeks[4][6].inMonth, false);
  assert.equal(weekdayOf("2026-10-01"), "thursday");
});

test("disables past days relative to now in the chosen timezone", () => {
  const utc = buildPickerMonth(2026, 10, { now, timezone: "UTC" }).weeks.flat();
  const byKey = (days: typeof utc, key: string) => days.find((day) => day.key === key);
  assert.equal(byKey(utc, "2026-10-20")?.isPast, true);
  assert.equal(byKey(utc, "2026-10-21")?.isPast, false);
  assert.equal(byKey(utc, "2026-10-21")?.isToday, true);
  // 2026-10-21T15:20Z is already Oct 22 in Tokyo, so Oct 21 is past there.
  const tokyo = buildPickerMonth(2026, 10, { now, timezone: "Asia/Tokyo" }).weeks.flat();
  assert.equal(byKey(tokyo, "2026-10-21")?.isPast, true);
  assert.equal(byKey(tokyo, "2026-10-22")?.isToday, true);
  assert.deepEqual(zonedNow(now, "America/Argentina/Buenos_Aires"), { date: "2026-10-21", time: "12:20" });
});

test("composes and parses the queue's local date-time string", () => {
  assert.equal(composeLocalDateTime("2026-10-22", "18:30"), "2026-10-22T18:30:00");
  assert.equal(composeLocalDateTime("2026-10-22", "24:00"), null);
  assert.equal(composeLocalDateTime("2026-02-30", "10:00"), null);
  assert.deepEqual(parseLocalDateTime("2026-10-22T18:30:00"), { date: "2026-10-22", time: "18:30" });
  assert.deepEqual(parseLocalDateTime("2026-10-22T09:00"), { date: "2026-10-22", time: "09:00" });
  assert.equal(parseLocalDateTime("2026-10-22 09:00"), null);
  assert.equal(parseLocalDateTime("2026-13-01T09:00"), null);
});

test("lists 15-minute time options and disables past times today", () => {
  assert.equal(TIME_OPTIONS.length, 96);
  assert.equal(TIME_OPTIONS[1], "00:15");
  assert.equal(TIME_OPTIONS.at(-1), "23:45");
  const today = timeOptionsForDay("2026-10-21", { now, timezone: "UTC" });
  assert.equal(today.find((option) => option.value === "15:15")?.disabled, true);
  assert.equal(today.find((option) => option.value === "15:30")?.disabled, false);
  const tomorrow = timeOptionsForDay("2026-10-22", { now, timezone: "UTC" });
  assert.ok(tomorrow.every((option) => !option.disabled));
});

test("rejects DST-gap times, past times and invalid timezones", () => {
  const march = new Date("2026-03-01T00:00:00.000Z");
  // America/New_York skips 02:00-02:59 on 2026-03-08.
  const gap = validateLocalDateTime("2026-03-08T02:30:00", "America/New_York", march);
  assert.equal(gap.ok, false);
  if (!gap.ok) assert.match(gap.message, /does not exist/);
  const options = timeOptionsForDay("2026-03-08", { now: march, timezone: "America/New_York" });
  assert.equal(options.find((option) => option.value === "02:30")?.disabled, true);
  assert.equal(options.find((option) => option.value === "03:00")?.disabled, false);
  assert.deepEqual(validateLocalDateTime("2026-03-08T03:00:00", "America/New_York", march), { ok: true, utc: "2026-03-08T07:00:00.000Z" });
  // 01:30 happens twice on 2026-11-01 (fold): ambiguous, so it is rejected too.
  assert.equal(validateLocalDateTime("2026-11-01T01:30:00", "America/New_York", march).ok, false);
  const fold = timeOptionsForDay("2026-11-01", { now: march, timezone: "America/New_York" });
  assert.equal(fold.find((option) => option.value === "01:30")?.disabled, true);
  assert.equal(fold.find((option) => option.value === "02:00")?.disabled, false);
  const past = validateLocalDateTime("2026-10-21T10:00:00", "UTC", now);
  assert.equal(past.ok, false);
  if (!past.ok) assert.match(past.message, /future/);
  assert.equal(validateLocalDateTime("2026-10-22T10:00:00", "Not/AZone", now).ok, false);
});

test("maps best publish slots to highlighted days and hours", () => {
  const highlights = bestSlotHighlights([slot("thursday", 18, 21, 1.8), slot("saturday", 9, 12, 1.2)]);
  const days = buildPickerMonth(2026, 10, { now, timezone: "UTC", highlights }).weeks.flat();
  assert.equal(days.find((day) => day.key === "2026-10-22")?.recommended, true);
  assert.equal(days.find((day) => day.key === "2026-10-24")?.recommended, true);
  assert.equal(days.find((day) => day.key === "2026-10-23")?.recommended, false);
  const thursday = timeOptionsForDay("2026-10-22", { now, timezone: "UTC", highlights });
  assert.equal(thursday.find((option) => option.value === "18:00")?.recommended, true);
  assert.equal(thursday.find((option) => option.value === "20:45")?.recommended, true);
  assert.equal(thursday.find((option) => option.value === "21:00")?.recommended, false);
  assert.equal(bestSlotHighlights([]).size, 0);
});

test("shifts months and lists timezones including the current one", () => {
  assert.deepEqual(shiftPickerMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftPickerMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  const zones = timezoneOptions("Pacific/Chatham");
  assert.ok(zones.includes("Pacific/Chatham"));
  assert.ok(zones.includes("UTC"));
  assert.equal(new Set(timezoneOptions("UTC")).size, timezoneOptions("UTC").length);
});

test("loads best slots and ignores every failure", async () => {
  let requested = "";
  const slots = await fetchBestSlots("America/New_York", async (url) => {
    requested = url;
    return Response.json({ kind: "best-publish-times", slots: [slot("monday", 9, 12)] });
  });
  assert.equal(requested, "/api/youtube/best-publish-times?timezone=America%2FNew_York");
  assert.equal(slots.length, 1);
  assert.deepEqual(await fetchBestSlots("UTC", async () => Response.json({ kind: "best-publish-times-error" }, { status: 403 })), []);
  assert.deepEqual(await fetchBestSlots("UTC", async () => { throw new Error("offline"); }), []);
  assert.deepEqual(await fetchBestSlots("UTC", async () => Response.json({ kind: "best-publish-times", slots: [{ weekday: "funday" }] })), []);
});

test("accepts a valid future calendar prefill only", () => {
  assert.deepEqual(initialScheduleFromQuery("2026-10-22T09:00", "America/Argentina/Buenos_Aires", now), {
    localDateTime: "2026-10-22T09:00:00",
    timezone: "America/Argentina/Buenos_Aires",
  });
  assert.equal(initialScheduleFromQuery("2026-10-20T09:00", "UTC", now), null);
  assert.equal(initialScheduleFromQuery("2026-10-22T09:00", "Not/AZone", now), null);
  assert.equal(initialScheduleFromQuery(null, "UTC", now), null);
  assert.equal(initialScheduleFromQuery("garbage", "UTC", now), null);
});

test("defaults a picked day to the next slot today, the first best slot, or 09:00", () => {
  // now is 15:20 UTC: today defaults to the next 15-minute slot, never a past time.
  assert.equal(defaultTimeForDay("2026-10-21", { now, timezone: "UTC" }), "15:30");
  const highlights = bestSlotHighlights([slot("thursday", 18, 21), slot("wednesday", 20, 22)]);
  assert.equal(defaultTimeForDay("2026-10-21", { now, timezone: "UTC", highlights }), "15:30");
  assert.equal(defaultTimeForDay("2026-10-22", { now, timezone: "UTC", highlights }), "18:00");
  assert.equal(defaultTimeForDay("2026-10-23", { now, timezone: "UTC", highlights }), "09:00");
  assert.equal(defaultTimeForDay("2026-10-23", { now, timezone: "UTC" }), "09:00");
});

test("allows the previous month only while it still has a non-past day", () => {
  assert.equal(canShowPreviousMonth({ year: 2026, month: 10 }, { now, timezone: "UTC" }), false);
  assert.equal(canShowPreviousMonth({ year: 2026, month: 9 }, { now, timezone: "UTC" }), false);
  assert.equal(canShowPreviousMonth({ year: 2026, month: 11 }, { now, timezone: "UTC" }), true);
  // 2026-11-01T02:00Z is still Oct 31 in New York, so October is not entirely past there.
  const early = new Date("2026-11-01T02:00:00.000Z");
  assert.equal(canShowPreviousMonth({ year: 2026, month: 11 }, { now: early, timezone: "UTC" }), false);
  assert.equal(canShowPreviousMonth({ year: 2026, month: 11 }, { now: early, timezone: "America/New_York" }), true);
});
