import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SocialPost } from "@/lib/social/contracts";
import { buildMonthGrid, buildWeekView, toCalendarItems } from "@/lib/schedule-calendar";
import {
  CalendarItemDetail,
  loadCalendarData,
  ScheduleCalendarContent,
} from "./schedule-calendar";

const NY = "America/New_York";
const NOW = new Date("2026-10-21T15:00:00Z"); // 11:00 in New York.

const post = (overrides: Partial<SocialPost> = {}): SocialPost => ({
  id: "p1",
  userId: "u1",
  accountId: "a1",
  platform: "tiktok",
  stagingFile: "clip.mp4",
  caption: "Launch teaser",
  platformOptions: {},
  scheduledAtUtc: "2026-10-22T14:00:00.000Z",
  timezone: NY,
  status: "scheduled",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  ...overrides,
});

const posts = [
  post(),
  post({ id: "p2", platform: "instagram", status: "failed", caption: "Old reel", scheduledAtUtc: "2026-10-20T16:00:00.000Z" }),
];
const videos = [{ videoId: "v1", title: "Big video", publishAt: "2026-10-23T18:00:00Z" }];
const items = toCalendarItems(posts, videos);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function month() {
  return renderToStaticMarkup(
    <ScheduleCalendarContent
      state={{ kind: "ready", data: { posts, videos, notice: null } }}
      mode="month"
      monthGrid={buildMonthGrid({ year: 2026, month: 10, timezone: NY, now: NOW, items })}
      week={null}
      timezone={NY}
      selectedId={null}
    />,
  );
}

test("month view renders a table with weekday headers and Monday first", () => {
  const markup = month();

  assert.match(markup, /<table[^>]*aria-label="October 2026"/);
  const headers = [...markup.matchAll(/<th[^>]*scope="col"[^>]*>.*?<\/th>/g)].map(([cell]) => cell);
  assert.equal(headers.length, 7);
  assert.match(headers[0], /Monday/);
  assert.match(headers[6], /Sunday/);
});

test("month view renders chips with platform, status and the full local date and time", () => {
  const markup = month();

  assert.match(markup, /aria-label="TikTok post, Scheduled, Thursday, October 22, 2026 at 10:00: Launch teaser"/);
  assert.match(markup, /aria-label="Instagram post, Failed, Tuesday, October 20, 2026 at 12:00: Old reel"/);
  assert.match(markup, /aria-label="YouTube video, Scheduled on YouTube, Friday, October 23, 2026 at 14:00: Big video"/);
});

test("month view links future days to the composer and leaves past days without a link", () => {
  const markup = month();

  const link = /<a[^>]*aria-label="New post on Thursday, October 22, 2026 at 09:00"[^>]*>/.exec(markup)?.[0] ?? "";
  assert.match(link, /href="\/dashboard\/social\?at=2026-10-22T09%3A00&amp;tz=America%2FNew_York"/);
  assert.match(markup, /href="\/dashboard\/social\?at=2026-10-21T12%3A00&amp;tz=America%2FNew_York"/);
  assert.doesNotMatch(markup, /at=2026-10-20T/);
});

test("week view links empty future hours only and marks the current day", () => {
  const markup = renderToStaticMarkup(
    <ScheduleCalendarContent
      state={{ kind: "ready", data: { posts, videos, notice: null } }}
      mode="week"
      monthGrid={null}
      week={buildWeekView({ anchor: "2026-10-21", timezone: NY, now: NOW, items })}
      timezone={NY}
      selectedId={null}
    />,
  );

  assert.match(markup, /aria-label="New post on Wednesday, October 21, 2026 at 12:00"/);
  assert.doesNotMatch(markup, /New post on Wednesday, October 21, 2026 at 11:00/);
  // The 10:00 Thursday hour holds a post, so it offers no empty-slot link.
  assert.doesNotMatch(markup, /New post on Thursday, October 22, 2026 at 10:00/);
  assert.match(markup, /aria-label="TikTok post, Scheduled, Thursday, October 22, 2026 at 10:00: Launch teaser"/);
  assert.match(markup, /<th[^>]*scope="row"[^>]*>09:00<\/th>/);
  assert.match(markup, /aria-current="date"/);
});

test("content shows loading, error and the YouTube notice", () => {
  const render = (state: Parameters<typeof ScheduleCalendarContent>[0]["state"]) =>
    renderToStaticMarkup(
      <ScheduleCalendarContent state={state} mode="month" monthGrid={null} week={null} timezone={NY} selectedId={null} />,
    );

  assert.match(render({ kind: "loading" }), /role="status"[^>]*>Loading schedules/);
  assert.match(render({ kind: "error", message: "Session expired. Sign in again." }), /role="alert"[^>]*>Session expired/);
  assert.match(
    renderToStaticMarkup(
      <ScheduleCalendarContent
        state={{ kind: "ready", data: { posts: [], videos: [], notice: "Scheduled YouTube videos could not be loaded." } }}
        mode="month"
        monthGrid={buildMonthGrid({ year: 2026, month: 10, timezone: NY, now: NOW, items: [] })}
        week={null}
        timezone={NY}
        selectedId={null}
      />,
    ),
    /Scheduled YouTube videos could not be loaded\.[\s\S]*Nothing scheduled in this period/,
  );
});

test("detail for a social post offers reschedule and cancel with local and UTC times", () => {
  const markup = renderToStaticMarkup(
    <CalendarItemDetail item={items[1]} post={posts[0]} timezone={NY} busy={false} />,
  );

  assert.match(markup, /Launch teaser/);
  assert.match(markup, /TikTok/);
  assert.match(markup, /Scheduled/);
  assert.match(markup, /Oct 22, 2026, 10:00 \(America\/New_York\)/);
  assert.match(markup, /Oct 22, 2026, 14:00 UTC/);
  assert.match(markup, />Reschedule<\/button>/);
  assert.match(markup, />Cancel post<\/button>/);
});

test("detail for a YouTube video is read-only and links to YouTube Studio", () => {
  const youtube = items.find((entry) => entry.source === "youtube");
  assert.ok(youtube);
  const markup = renderToStaticMarkup(<CalendarItemDetail item={youtube} timezone={NY} busy={false} />);

  assert.match(markup, /Big video/);
  assert.match(markup, /Read-only/);
  assert.match(markup, /href="https:\/\/studio\.youtube\.com\/video\/v1\/edit"/);
  assert.doesNotMatch(markup, /Reschedule/);
  assert.doesNotMatch(markup, /Cancel post/);
});

test("detail hides actions that the post status does not allow", () => {
  const published = post({ status: "published" });
  const [item] = toCalendarItems([published], []);
  const markup = renderToStaticMarkup(<CalendarItemDetail item={item} post={published} timezone={NY} busy={false} />);

  assert.doesNotMatch(markup, /Reschedule/);
  assert.doesNotMatch(markup, /Cancel post/);
});

test("loadCalendarData merges both sources and keeps social posts when YouTube needs a scope", async () => {
  const calls: string[] = [];
  const ok = await loadCalendarData(async (url) => {
    calls.push(url);
    return url === "/api/social/posts" ? json(200, posts) : json(200, { kind: "youtube-scheduled-videos", videos });
  });
  assert.deepEqual(calls.sort(), ["/api/social/posts", "/api/youtube/scheduled"]);
  assert.deepEqual(ok, { kind: "ready", data: { posts, videos, notice: null } });

  const scope = await loadCalendarData(async (url) =>
    url === "/api/social/posts"
      ? json(200, posts)
      : json(403, { kind: "youtube-scheduled-videos-error", code: "AUTH_SCOPE_INSUFFICIENT", message: "x" }),
  );
  assert.equal(scope.kind, "ready");
  assert.ok(scope.kind === "ready" && scope.data.videos.length === 0 && /youtube\.readonly/.test(scope.data.notice ?? ""));
});

test("loadCalendarData reports a session error when the social posts request is unauthorized", async () => {
  const result = await loadCalendarData(async (url) =>
    url === "/api/social/posts"
      ? json(401, { error: "UNAUTHORIZED" })
      : json(401, { kind: "youtube-scheduled-videos-error", code: "AUTH_REQUIRED", message: "x" }),
  );

  assert.deepEqual(result, { kind: "error", message: "Session expired. Sign in again." });
});

function tabbableSlots(markup: string): { tabbable: string[]; total: number } {
  const links = [...markup.matchAll(/<a[^>]*aria-label="New post on [^"]*"[^>]*>/g)].map(([tag]) => tag);
  return {
    tabbable: links.filter((tag) => /tabindex="0"/.test(tag)).map((tag) => /aria-label="([^"]*)"/.exec(tag)?.[1] ?? ""),
    total: links.filter((tag) => /tabindex="-1"/.test(tag)).length + links.filter((tag) => /tabindex="0"/.test(tag)).length,
  };
}

test("week view keeps a single empty slot in the tab order", () => {
  const markup = renderToStaticMarkup(
    <ScheduleCalendarContent
      state={{ kind: "ready", data: { posts, videos, notice: null } }}
      mode="week"
      monthGrid={null}
      week={buildWeekView({ anchor: "2026-10-21", timezone: NY, now: NOW, items })}
      timezone={NY}
      selectedId={null}
    />,
  );

  const slots = tabbableSlots(markup);
  assert.ok(slots.total > 50);
  assert.deepEqual(slots.tabbable, ["New post on Wednesday, October 21, 2026 at 12:00"]);
});

test("month view keeps a single empty slot in the tab order", () => {
  const slots = tabbableSlots(month());

  assert.ok(slots.total > 5);
  assert.deepEqual(slots.tabbable, ["New post on Wednesday, October 21, 2026 at 12:00"]);
});
