import assert from "node:assert/strict";
import test from "node:test";
import type { SocialPost } from "@/lib/social/contracts";
import {
  buildMonthGrid,
  buildWeekView,
  composerHref,
  formatDayLabel,
  shiftDays,
  shiftMonth,
  toCalendarItems,
  todayKey,
  zonedTimeToUtc,
  type CalendarItem,
} from "..";

const NY = "America/New_York";
// 2026-10-21 11:00 in New York (EDT, UTC-4).
const NOW = new Date("2026-10-21T15:00:00Z");

const item = (id: string, at: string, source: CalendarItem["source"] = "tiktok"): CalendarItem => ({
  id,
  source,
  status: source === "youtube" ? "youtube-scheduled" : "scheduled",
  title: id,
  at,
});

const post = (overrides: Partial<SocialPost>): SocialPost => ({
  id: "p1",
  userId: "u1",
  accountId: "a1",
  platform: "tiktok",
  stagingFile: "clip.mp4",
  caption: "Hello",
  platformOptions: {},
  scheduledAtUtc: "2026-10-22T14:00:00.000Z",
  timezone: NY,
  status: "scheduled",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  ...overrides,
});

test("month grid is Monday-first with leading and trailing days", () => {
  const grid = buildMonthGrid({ year: 2026, month: 10, timezone: NY, now: NOW, items: [] });

  assert.equal(grid.weeks.length, 5);
  assert.deepEqual(grid.weeks[0].slice(0, 4).map((day) => [day.key, day.inMonth]), [
    ["2026-09-28", false],
    ["2026-09-29", false],
    ["2026-09-30", false],
    ["2026-10-01", true],
  ]);
  assert.deepEqual(grid.weeks[4].slice(5).map((day) => [day.key, day.inMonth]), [
    ["2026-10-31", true],
    ["2026-11-01", false],
  ]);
  assert.ok(grid.weeks.every((week) => week.length === 7));
});

test("month grid without leading or trailing days when the month fills whole weeks", () => {
  const grid = buildMonthGrid({ year: 2027, month: 2, timezone: NY, now: NOW, items: [] });

  assert.equal(grid.weeks.length, 4);
  assert.equal(grid.weeks[0][0].key, "2027-02-01");
  assert.equal(grid.weeks[3][6].key, "2027-02-28");
  assert.ok(grid.weeks.flat().every((day) => day.inMonth));
});

test("month grid marks today, past and future days and offers composer slots only ahead of now", () => {
  const days = buildMonthGrid({ year: 2026, month: 10, timezone: NY, now: NOW, items: [] }).weeks.flat();
  const byKey = new Map(days.map((day) => [day.key, day]));

  assert.equal(byKey.get("2026-10-20")?.isPast, true);
  assert.equal(byKey.get("2026-10-20")?.slot, null);
  assert.equal(byKey.get("2026-10-21")?.isToday, true);
  assert.equal(byKey.get("2026-10-21")?.slot, "2026-10-21T12:00");
  assert.equal(byKey.get("2026-10-22")?.isPast, false);
  assert.equal(byKey.get("2026-10-22")?.slot, "2026-10-22T09:00");
  assert.equal(days.filter((day) => day.isToday).length, 1);
});

test("month grid buckets items into local days, across midnight per timezone, in time order", () => {
  const items = [
    item("late", "2026-10-22T02:30:00Z"), // Oct 21 22:30 in New York, Oct 22 11:30 in Tokyo.
    item("early", "2026-10-21T13:00:00Z"),
    item("yt", "2026-10-21T13:00:00Z", "youtube"),
  ];
  const ny = buildMonthGrid({ year: 2026, month: 10, timezone: NY, now: NOW, items }).weeks.flat();
  const tokyo = buildMonthGrid({ year: 2026, month: 10, timezone: "Asia/Tokyo", now: NOW, items }).weeks.flat();

  assert.deepEqual(ny.find((day) => day.key === "2026-10-21")?.items.map((entry) => entry.id), ["early", "yt", "late"]);
  assert.deepEqual(ny.find((day) => day.key === "2026-10-22")?.items, []);
  assert.deepEqual(tokyo.find((day) => day.key === "2026-10-21")?.items.map((entry) => entry.id), ["early", "yt"]);
  assert.deepEqual(tokyo.find((day) => day.key === "2026-10-22")?.items.map((entry) => entry.id), ["late"]);
});

test("items in leading days of the next month view stay visible and invalid dates are dropped", () => {
  const items = [item("prev", "2026-09-29T16:00:00Z"), item("bad", "not-a-date")];
  const days = buildMonthGrid({ year: 2026, month: 10, timezone: NY, now: NOW, items }).weeks.flat();

  assert.deepEqual(days.find((day) => day.key === "2026-09-29")?.items.map((entry) => entry.id), ["prev"]);
  assert.equal(days.flatMap((day) => day.items).length, 1);
});

test("shiftMonth and shiftDays cross month and year boundaries", () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 10, 0), { year: 2026, month: 10 });
  assert.equal(shiftDays("2026-12-29", 7), "2027-01-05");
  assert.equal(shiftDays("2024-03-01", -1), "2024-02-29");
});

test("todayKey follows the timezone across midnight", () => {
  const instant = new Date("2026-10-22T02:30:00Z");
  assert.equal(todayKey(instant, NY), "2026-10-21");
  assert.equal(todayKey(instant, "Asia/Tokyo"), "2026-10-22");
  assert.equal(todayKey(instant, "UTC"), "2026-10-22");
});

test("week view starts on Monday, has 24 hours per day and buckets items by local hour", () => {
  const items = [item("b", "2026-10-21T18:30:00Z"), item("a", "2026-10-21T18:05:00Z")];
  const week = buildWeekView({ anchor: "2026-10-21", timezone: NY, now: NOW, items });

  assert.deepEqual(week.days.map((day) => day.key), [
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ]);
  assert.ok(week.days.every((day) => day.hours.length === 24));
  const wednesday = week.days[2];
  assert.deepEqual(wednesday.hours[14].items.map((entry) => entry.id), ["a", "b"]);
  assert.equal(wednesday.hours[14].localDateTime, "2026-10-21T14:00");
});

test("week view marks hours at or before now as past and links only future slots", () => {
  const week = buildWeekView({ anchor: "2026-10-21", timezone: NY, now: NOW, items: [] });
  const wednesday = week.days[2];

  assert.equal(wednesday.hours[11].isPast, true); // 11:00 EDT is exactly now.
  assert.equal(wednesday.hours[11].slot, null);
  assert.equal(wednesday.hours[12].isPast, false);
  assert.equal(wednesday.hours[12].slot, "2026-10-21T12:00");
  assert.equal(week.days[1].hours[23].isPast, true);
});

test("week view on the spring-forward day skips the missing 02:00 hour in New York", () => {
  const items = [item("before", "2026-03-08T06:30:00Z"), item("after", "2026-03-08T07:30:00Z")];
  const week = buildWeekView({ anchor: "2026-03-08", timezone: NY, now: new Date("2026-03-01T00:00:00Z"), items });
  const sunday = week.days[6];

  assert.equal(sunday.key, "2026-03-08");
  assert.equal(sunday.hours[2].exists, false);
  assert.equal(sunday.hours[2].slot, null);
  assert.deepEqual(sunday.hours[1].items.map((entry) => entry.id), ["before"]);
  assert.deepEqual(sunday.hours[3].items.map((entry) => entry.id), ["after"]);
  assert.equal(sunday.hours[3].utc, "2026-03-08T07:00:00.000Z");
});

test("week view on the fall-back day keeps both 01:00 occurrences in the same hour", () => {
  const items = [item("est", "2026-11-01T06:30:00Z"), item("edt", "2026-11-01T05:30:00Z")];
  const week = buildWeekView({ anchor: "2026-11-01", timezone: NY, now: new Date("2026-10-01T00:00:00Z"), items });
  const sunday = week.days[6];

  assert.deepEqual(sunday.hours[1].items.map((entry) => entry.id), ["edt", "est"]);
  assert.equal(sunday.hours[1].exists, true);
  assert.equal(sunday.hours[0].utc, "2026-11-01T04:00:00.000Z");
});

test("zonedTimeToUtc converts wall time and rejects nonexistent local times", () => {
  assert.equal(zonedTimeToUtc("2026-10-21T14:00", NY), Date.parse("2026-10-21T18:00:00Z"));
  assert.equal(zonedTimeToUtc("2026-01-15T09:00", NY), Date.parse("2026-01-15T14:00:00Z"));
  assert.equal(zonedTimeToUtc("2026-10-21T09:00", "Asia/Tokyo"), Date.parse("2026-10-21T00:00:00Z"));
  assert.equal(zonedTimeToUtc("2026-03-08T02:30", NY), null);
});

test("toCalendarItems merges social posts and YouTube videos sorted by time", () => {
  const items = toCalendarItems(
    [
      post({ id: "p2", platform: "instagram", status: "failed", caption: "Second", scheduledAtUtc: "2026-10-23T10:00:00.000Z" }),
      post({ id: "p1", caption: "First" }),
    ],
    [{ videoId: "v1", title: "Video", publishAt: "2026-10-22T14:00:00Z", thumbnailUrl: "https://i.ytimg.com/v1.jpg" }],
  );

  assert.deepEqual(items, [
    { id: "social:p1", source: "tiktok", status: "scheduled", title: "First", at: "2026-10-22T14:00:00.000Z" },
    {
      id: "youtube:v1",
      source: "youtube",
      status: "youtube-scheduled",
      title: "Video",
      at: "2026-10-22T14:00:00.000Z",
      href: "https://studio.youtube.com/video/v1/edit",
    },
    { id: "social:p2", source: "instagram", status: "failed", title: "Second", at: "2026-10-23T10:00:00.000Z" },
  ]);
});

test("toCalendarItems falls back to a placeholder title for empty captions", () => {
  const [entry] = toCalendarItems([post({ caption: "   " })], []);
  assert.equal(entry.title, "(no caption)");
});

test("composerHref encodes the local time and timezone", () => {
  assert.equal(
    composerHref("2026-10-22T09:00", "America/Argentina/Buenos_Aires"),
    "/dashboard/social?at=2026-10-22T09%3A00&tz=America%2FArgentina%2FBuenos_Aires",
  );
});

test("formatDayLabel spells out the full date independent of the host timezone", () => {
  assert.equal(formatDayLabel("2026-10-21"), "Wednesday, October 21, 2026");
});
