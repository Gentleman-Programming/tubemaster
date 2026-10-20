import assert from "node:assert/strict";
import test from "node:test";
import { earlyWindow, localSlot, median, rankPublishSlots } from "../slots";

test("buckets a publish instant into the local weekday and 3-hour block of the requested timezone", () => {
  assert.deepEqual(localSlot("2026-02-02T21:00:00Z", "America/Argentina/Buenos_Aires"), {
    weekday: "monday",
    startHour: 18,
  });
  assert.deepEqual(localSlot("2026-02-07T02:59:00Z", "America/Argentina/Buenos_Aires"), {
    weekday: "friday",
    startHour: 21,
  });
  assert.deepEqual(localSlot("2026-02-02T21:00:00Z", "Asia/Tokyo"), { weekday: "tuesday", startHour: 6 });
});

test("derives the 3-day early window from the Pacific-time publish date", () => {
  assert.deepEqual(earlyWindow("2026-02-07T03:00:00Z"), { startDate: "2026-02-06", endDate: "2026-02-08" });
  assert.deepEqual(earlyWindow("2026-02-28T12:00:00Z"), { startDate: "2026-02-28", endDate: "2026-03-02" });
});

test("computes the median of odd and even samples", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([10, 50, 70, 80]), 60);
});

test("recommends nothing when the channel median early views is zero", () => {
  const samples = [
    { videoId: "a", publishedAt: "2026-02-02T21:00:00Z", earlyViews: 0 },
    { videoId: "b", publishedAt: "2026-02-09T21:00:00Z", earlyViews: 0 },
  ];
  assert.deepEqual(rankPublishSlots(samples, "UTC"), { channelMedianEarlyViews: 0, slots: [] });
});
