import assert from "node:assert/strict";
import { test } from "node:test";
import { youtubeSchedulingProvider } from "./youtube-api";

test("YouTube scheduling adapter exposes separate read and write operations", () => {
  assert.equal(typeof youtubeSchedulingProvider.inspect, "function");
  assert.equal(typeof youtubeSchedulingProvider.schedule, "function");
});
