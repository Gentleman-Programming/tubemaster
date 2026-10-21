import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublishSlot } from "@/lib/youtube-best-publish-times/contracts";
import { DateTimePicker } from "..";

const now = new Date("2026-10-21T15:20:00.000Z");
const bestSlots: PublishSlot[] = [{ weekday: "thursday", startHour: 18, endHour: 21, score: 1.8, sampleSize: 5, medianEarlyViews: 120 }];
const noop = () => {};

test("renders an accessible month grid with full date labels", () => {
  const html = renderToStaticMarkup(
    <DateTimePicker label="Publish date" timeLabel="Publish time" value={null} onChange={noop} now={now} timezone="UTC" />,
  );
  assert.match(html, /role="grid"/);
  assert.match(html, /aria-label="Publish date, October 2026"/);
  assert.equal(html.match(/role="columnheader"/g)?.length, 7);
  assert.equal(html.match(/role="gridcell"/g)?.length, 35);
  assert.match(html, /aria-label="Thursday, October 22, 2026"/);
  assert.match(html, /aria-label="Previous month"/);
  assert.match(html, /aria-label="Next month"/);
  assert.match(html, /aria-label="Publish time"/);
  assert.match(html, /aria-label="IANA timezone"/);
  // Only today's (or the selected) day is in the tab order.
  assert.equal(html.match(/tabindex="0"/g)?.length, 1);
  assert.doesNotMatch(html, /Best time/);
});

test("marks past days disabled and the selected day", () => {
  const html = renderToStaticMarkup(
    <DateTimePicker
      label="Publish date"
      value={{ localDateTime: "2026-10-22T18:30:00", timezone: "America/Argentina/Buenos_Aires" }}
      onChange={noop}
      now={now}
    />,
  );
  assert.match(html, /aria-disabled="true"[^>]*aria-label="Tuesday, October 20, 2026"|aria-label="Tuesday, October 20, 2026"[^>]*aria-disabled="true"/);
  assert.doesNotMatch(html, /aria-label="Friday, October 23, 2026"[^>]*aria-disabled="true"/);
  assert.equal(html.match(/aria-selected="true"/g)?.length, 1);
  assert.match(html, /<option value="18:30" selected="">/);
  assert.match(html, /<option value="America\/Argentina\/Buenos_Aires" selected="">/);
  assert.match(html, /Thursday, October 22, 2026 · 18:30 \(America\/Argentina\/Buenos_Aires\)/);
  assert.match(html, /2026-10-22 21:30 UTC/);
});

test("highlights recommended slots with a legend", () => {
  const html = renderToStaticMarkup(
    <DateTimePicker
      label="Publish date"
      value={{ localDateTime: "2026-10-22T18:30:00", timezone: "UTC" }}
      onChange={noop}
      now={now}
      bestSlots={bestSlots}
    />,
  );
  assert.match(html, /aria-label="Thursday, October 22, 2026, best time"/);
  assert.doesNotMatch(html, /aria-label="Friday, October 23, 2026, best time"/);
  assert.match(html, /18:00 · Best time/);
  assert.match(html, /Best time/);
  assert.match(html, /recommended from your channel/);
});

test("explains a DST gap instead of showing a UTC time", () => {
  const html = renderToStaticMarkup(
    <DateTimePicker
      label="Publish date"
      value={{ localDateTime: "2026-03-08T02:30:00", timezone: "America/New_York" }}
      onChange={noop}
      now={new Date("2026-03-01T00:00:00.000Z")}
    />,
  );
  assert.match(html, /does not exist or is ambiguous/);
  assert.doesNotMatch(html, / UTC</);
});

test("disables Previous month while viewing the current month", () => {
  const html = renderToStaticMarkup(
    <DateTimePicker label="Publish date" value={null} onChange={noop} now={now} timezone="UTC" />,
  );
  assert.match(html, /<button[^>]*aria-label="Previous month"[^>]*disabled=""/);
  assert.doesNotMatch(html, /<button[^>]*aria-label="Next month"[^>]*disabled=""/);

  const november = renderToStaticMarkup(
    <DateTimePicker label="Publish date" value={{ localDateTime: "2026-11-10T09:00:00", timezone: "UTC" }} onChange={noop} now={now} />,
  );
  assert.doesNotMatch(november, /<button[^>]*aria-label="Previous month"[^>]*disabled=""/);
});

test("notes when best times are unavailable and stays quiet while they load", () => {
  const render = (slots: readonly PublishSlot[] | null) =>
    renderToStaticMarkup(<DateTimePicker label="Publish date" value={null} onChange={noop} now={now} timezone="UTC" bestSlots={slots} />);

  assert.match(render([]), /Best times unavailable/);
  assert.doesNotMatch(render(null), /Best time/);
  assert.doesNotMatch(render(bestSlots), /Best times unavailable/);
});
