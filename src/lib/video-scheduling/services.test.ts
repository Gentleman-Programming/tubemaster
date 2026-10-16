import assert from "node:assert/strict";
import { test } from "node:test";
import { createVideoSchedulingService } from "./services";
import { toUnambiguousUtc } from "./schemas";

const request = { credentialRef: { userId: "user" }, videoId: "video", expectedChannelId: "channel", timezone: "America/New_York", publishAt: "2030-01-02T10:00:00", dryRun: true };
function setup(video = { channelId: "channel", privacyStatus: "private" }) {
  const writes: unknown[] = [];
  const records: unknown[] = [];
  const schedule = createVideoSchedulingService({
    authResolver: { resolve: async () => ({ credentialRef: request.credentialRef, accessToken: "secret", scopeSet: new Set() }) },
    writeContext: { assertWriteChannel: async ({ expectedChannelId }) => {
      if (expectedChannelId !== "channel") throw new Error("wrong channel");
      return { expectedChannelId };
    } },
    provider: {
      inspect: async () => video,
      schedule: async (args) => { writes.push(args); },
    },
    quotaAccountantFactory: () => ({ record: (record) => { records.push(record); } }),
    confirmationSecret: "test-secret", now: () => Date.parse("2029-01-01T00:00:00Z"), operationIdFactory: () => "op",
  });
  return { schedule, writes, records };
}
test("preview converts explicit timezone and confirmed matching preview schedules", async () => {
  const { schedule, writes } = setup();
  const preview = await schedule(request);
  assert.equal(preview.publishAtUtc, "2030-01-02T15:00:00.000Z");
  assert.equal(preview.quotaEstimate, 51);
  assert.equal(writes.length, 0);
  const result = await schedule({ ...request, dryRun: false, confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal(result.status, "scheduled");
  assert.equal(writes.length, 1);
});
test("rejects missing, tampered and stale confirmations before mutation", async () => {
  const { schedule, writes } = setup();
  const preview = await schedule(request);
  for (const input of [
    { ...request, dryRun: false, confirmed: true },
    { ...request, dryRun: false, confirmed: true, confirmationToken: preview.confirmationToken, publishAt: "2030-01-03T10:00:00" },
    { ...request, dryRun: false, confirmed: true, confirmationToken: `1.${preview.confirmationToken?.split(".")[1]}` },
  ]) await assert.rejects(schedule(input), { code: "validation_failed" });
  assert.equal(writes.length, 0);
});
test("rejects wrong video state, invalid time, past time, and DST folds/gaps", async () => {
  for (const video of [{ channelId: "other", privacyStatus: "private" }, { channelId: "channel", privacyStatus: "public" }]) {
    const { schedule, writes } = setup(video);
    await assert.rejects(schedule(request), { code: "validation_failed" });
    assert.equal(writes.length, 0);
  }
  const { schedule } = setup();
  await assert.rejects(schedule({ ...request, publishAt: "2020-01-02T10:00:00" }), { code: "validation_failed" });
  assert.equal(toUnambiguousUtc("2030-03-10T02:30:00", "America/New_York"), null);
  assert.equal(toUnambiguousUtc("2030-11-03T01:30:00", "America/New_York"), null);
});
