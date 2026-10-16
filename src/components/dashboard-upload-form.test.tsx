import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleInputType, scheduleMessage, schedulePayload, scheduleTimezoneOptions, stagingFailureMessage, uploadMessage, uploadPayload, validateSchedule, validateUpload } from "./dashboard-upload-form";

const fields = { stagingFile: "clip.mp4", title: "  Short  ", description: "About", expectedChannelId: "UC123" };

const schedule = { videoId: "video-1", expectedChannelId: "UC123", date: "2030-05-12", time: "09:30", timezone: "America/New_York" };

test("schedule fields use the correct native input types", () => {
  assert.equal(scheduleInputType("videoId"), "text");
  assert.equal(scheduleInputType("date"), "date");
  assert.equal(scheduleInputType("time"), "time");
});

test("timezone choices are exposed for the scheduling dropdown", () => {
  assert.ok(scheduleTimezoneOptions.some((option) => option.value === "UTC"));
  assert.ok(scheduleTimezoneOptions.some((option) => option.value === "America/New_York"));
  assert.ok(scheduleTimezoneOptions.some((option) => option.value === "Europe/Madrid"));
  assert.ok(scheduleTimezoneOptions.every((option) => option.label && option.value));
});

test("scheduling validates date, time, channel, video and IANA timezone", () => {
  assert.deepEqual(validateSchedule(schedule), {});
  assert.ok(validateSchedule({ ...schedule, date: "2030-02-30" }).date);
  assert.ok(validateSchedule({ ...schedule, time: "25:00" }).time);
  assert.ok(validateSchedule({ ...schedule, timezone: "Mars/Olympus" }).timezone);
  assert.ok(validateSchedule({ ...schedule, videoId: " " }).videoId);
  assert.ok(validateSchedule({ ...schedule, expectedChannelId: " " }).expectedChannelId);
});

test("schedule payload keeps exact preview identity and token on confirmation", () => {
  assert.deepEqual(schedulePayload(schedule, true), { videoId: "video-1", expectedChannelId: "UC123", timezone: "America/New_York", publishAt: "2030-05-12T09:30:00", dryRun: true, confirmed: false });
  assert.deepEqual(schedulePayload(schedule, false, "exact.token"), { ...schedulePayload(schedule, true), dryRun: false, confirmed: true, confirmationToken: "exact.token" });
});

test("schedule messages cover safe outcomes with operation IDs", () => {
  assert.match(scheduleMessage({ status: "validated", operationId: "op-1" }, true), /No change.*op-1/);
  assert.match(scheduleMessage({ status: "scheduled", publishAtUtc: "2030-05-12T13:30:00.000Z", operationId: "op-2" }, false), /scheduled.*op-2/);
  assert.match(scheduleMessage({ error: "unauthorized" }, false), /Sign in again/);
  assert.match(scheduleMessage({ error: "validation_failed" }, false), /preview again/);
  assert.match(scheduleMessage({ error: "update_failed", operationId: "op-3" }, false), /provider.*op-3/);
  assert.match(scheduleMessage({ outcome: "unknown", operationId: "op-4" }, false), /op-4.*Do not retry automatically/);
});

test("rejects paths and invalid fields before upload", () => {
  assert.deepEqual(validateUpload(fields), {});
  assert.ok(validateUpload({ ...fields, stagingFile: "../clip.mp4" }).stagingFile);
  assert.ok(validateUpload({ ...fields, stagingFile: "clip.exe" }).stagingFile);
  assert.ok(validateUpload({ ...fields, expectedChannelId: " " }).expectedChannelId);
  assert.ok(validateUpload({ ...fields, title: " " }).title);
  assert.ok(validateUpload({ ...fields, description: "a".repeat(5001) }).description);
});

test("preview and explicit confirmation send only adapter fields", () => {
  assert.deepEqual(uploadPayload(fields, true), { ...fields, title: "Short", dryRun: true, confirmed: false });
  assert.deepEqual(uploadPayload(fields, false), { ...fields, title: "Short", dryRun: false, confirmed: true });
});

test("staging failures only suggest fixing the video for validation errors", () => {
  assert.match(stagingFailureMessage(400), /Check its extension and size/);
  assert.match(stagingFailureMessage(401), /Sign in again/);
  assert.equal(stagingFailureMessage(500), "Video staging is unavailable. Try again later.");
  assert.equal(stagingFailureMessage(503), "Video staging is unavailable. Try again later.");
});

test("uncertain outcomes preserve operation ID and discourage retry", () => {
  assert.match(uploadMessage({ error: "update_failed", outcome: "unknown", operationId: "op-1" }, false), /op-1.*Check your YouTube channel.*Do not retry automatically/);
  assert.match(uploadMessage({ status: "uploaded", videoId: "v", operationId: "op-2" }, false), /Private upload complete.*op-2/);
  assert.match(uploadMessage({ status: "validated", channelId: "UC123" }, true), /No video was uploaded/);
});
