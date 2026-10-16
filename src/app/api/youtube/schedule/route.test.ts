import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "../../../../lib/video-metadata/contracts";
import { createSchedulePostHandler } from "./route";

const request = (body: string) => new Request("http://localhost/api/youtube/schedule", { method: "POST", body });
test("requires session and never calls scheduling for unauthenticated requests", async () => {
  let called = false;
  const post = createSchedulePostHandler({ getSession: async () => null, schedule: async () => { called = true; } });
  assert.equal((await post(request("{}"))).status, 401);
  assert.equal(called, false);
});
test("injects session identity through handler dependency and returns preview", async () => {
  const post = createSchedulePostHandler({ getSession: async () => ({ user: { id: "user" } }), schedule: async (userId, body) => ({ userId, body }) });
  const response = await post(request('{"videoId":"video"}'));
  assert.deepEqual(await response.json(), { userId: "user", body: { videoId: "video" } });
});
test("masks provider errors and exposes only safe uncertain-operation fields", async () => {
  const post = createSchedulePostHandler({ getSession: async () => ({ user: { id: "user" } }), schedule: async () => {
    throw new DomainError({ code: "update_failed", message: "private content", details: { operationId: "op", outcome: "unknown", token: "secret" } });
  } });
  const response = await post(request("{}"));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "update_failed", operationId: "op", outcome: "unknown", retryAutomatically: false });
});
