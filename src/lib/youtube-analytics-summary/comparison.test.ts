import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMetricDelta,
  calculatePeriodComparison,
  sumAnalyticsDays,
} from "./comparison";
import type { AnalyticsDayRow } from "./contracts";

const days: AnalyticsDayRow[] = [
  {
    date: "2025-06-09",
    views: 10,
    likes: 2,
    comments: 1,
    estimatedMinutesWatched: 5.5,
  },
  {
    date: "2025-06-15",
    views: 20,
    likes: 4,
    comments: 3,
    estimatedMinutesWatched: 7.5,
  },
];

test("calculates the immediately preceding inclusive period", () => {
  assert.deepEqual(calculatePeriodComparison("2025-06-09", "2025-06-15"), {
    current: { startDate: "2025-06-09", endDate: "2025-06-15" },
    previous: { startDate: "2025-06-02", endDate: "2025-06-08" },
  });
  assert.deepEqual(calculatePeriodComparison("2025-06-15", "2025-06-15"), {
    current: { startDate: "2025-06-15", endDate: "2025-06-15" },
    previous: { startDate: "2025-06-14", endDate: "2025-06-14" },
  });
});

test("rejects malformed, reversed, and over-limit comparison periods", () => {
  assert.throws(() => calculatePeriodComparison("bad", "2025-06-15"), /Invalid date/);
  assert.throws(() => calculatePeriodComparison("2025-06-16", "2025-06-15"), /startDate/);
  assert.throws(() => calculatePeriodComparison("2025-01-01", "2025-04-01"), /90 days/);
});

test("sums each supported analytics metric", () => {
  assert.deepEqual(sumAnalyticsDays(days), {
    views: 30,
    likes: 6,
    comments: 4,
    estimatedMinutesWatched: 13,
  });
});

test("calculates absolute and percentage deltas", () => {
  assert.deepEqual(calculateMetricDelta(30, 20), { absolute: 10, percentage: 50 });
  assert.deepEqual(calculateMetricDelta(0, 0), { absolute: 0, percentage: 0 });
  assert.deepEqual(calculateMetricDelta(10, 0), { absolute: 10, percentage: null });
  assert.deepEqual(calculateMetricDelta(0, 10), { absolute: -10, percentage: -100 });
});
