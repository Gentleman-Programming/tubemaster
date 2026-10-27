import assert from "node:assert/strict";
import { test } from "node:test";
import { youtubeRecoveryProvider } from "./youtube-api";

test("YouTube recovery adapter exposes reconciliation, inspection, and return-to-private capabilities", () => {
  assert.equal(typeof youtubeRecoveryProvider.reconcile, "function");
  assert.equal(typeof youtubeRecoveryProvider.inspect, "function");
  assert.equal(typeof youtubeRecoveryProvider.returnToPrivate, "function");
});
