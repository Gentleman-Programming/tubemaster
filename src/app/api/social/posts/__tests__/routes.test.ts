import assert from "node:assert/strict";
import test from "node:test";
import type { QueueErrorCode } from "../../../../../lib/social/queue/service";
import type { SocialQueueCore } from "../http";
import { createPostsHandlers } from "../route";
import { createPostHandlers } from "../[id]/route";
import { createConfirmHandler } from "../[id]/confirm/route";
import { createRescheduleHandler } from "../[id]/reschedule/route";
import { createCancelHandler } from "../[id]/cancel/route";

type Call = { method: string; args: unknown };

function fakeCore(result: unknown = { ok: true, value: { id: "post-1" } }) {
  const calls: Call[] = [];
  const record = (method: string) => async (args: unknown) => {
    calls.push({ method, args });
    return result;
  };
  const core = {
    preview: record("preview"),
    confirm: record("confirm"),
    reschedule: record("reschedule"),
    cancel: record("cancel"),
    list: record("list"),
    get: record("get"),
  } as unknown as SocialQueueCore;
  return { core, calls };
}

function deps(core: SocialQueueCore, userId: string | null = "user-1") {
  return { getSession: async () => (userId ? { user: { id: userId } } : null), getQueue: async () => core };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonRequest = (path: string, body: string, method = "POST") =>
  new Request(`http://localhost/api/social/posts${path}`, { method, body, headers: { "content-type": "application/json" } });

const previewBody = {
  platform: "tiktok",
  stagingFile: "clip.mp4",
  caption: "Hello",
  platformOptions: { privacyLevel: "SELF_ONLY" },
  schedule: { mode: "now" },
};

test("every handler returns 401 without a session and never calls the core", async () => {
  const { core, calls } = fakeCore();
  const d = deps(core, null);
  const responses = [
    await createPostsHandlers(d).GET(new Request("http://localhost/api/social/posts")),
    await createPostsHandlers(d).POST(jsonRequest("", JSON.stringify(previewBody))),
    await createPostHandlers(d).GET(new Request("http://localhost/api/social/posts/p"), params("p")),
    await createConfirmHandler(d)(jsonRequest("/p/confirm", '{"confirmationToken":"t"}'), params("p")),
    await createRescheduleHandler(d)(jsonRequest("/p/reschedule", '{"schedule":{"mode":"now"}}'), params("p")),
    await createCancelHandler(d)(jsonRequest("/p/cancel", ""), params("p")),
  ];
  assert.deepEqual(responses.map((response) => response.status), [401, 401, 401, 401, 401, 401]);
  assert.deepEqual(calls, []);
});

test("session user, body and route params are passed through to the core", async () => {
  const { core, calls } = fakeCore();
  const d = deps(core);

  const created = await createPostsHandlers(d).POST(jsonRequest("", JSON.stringify(previewBody)));
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { id: "post-1" });
  assert.equal((await createPostsHandlers(d).GET(new Request("http://localhost/api/social/posts?status=scheduled"))).status, 200);
  await createPostsHandlers(d).GET(new Request("http://localhost/api/social/posts"));
  await createPostHandlers(d).GET(new Request("http://localhost/api/social/posts/p1"), params("p1"));
  await createConfirmHandler(d)(jsonRequest("/p2/confirm", '{"confirmationToken":"tok"}'), params("p2"));
  await createRescheduleHandler(d)(
    jsonRequest("/p3/reschedule", '{"schedule":{"mode":"at","localDateTime":"2026-10-22T10:00:00","timezone":"UTC"}}'),
    params("p3"),
  );
  await createCancelHandler(d)(jsonRequest("/p4/cancel", ""), params("p4"));

  assert.deepEqual(calls, [
    { method: "preview", args: { ...previewBody, userId: "user-1" } },
    { method: "list", args: { userId: "user-1", status: "scheduled" } },
    { method: "list", args: { userId: "user-1" } },
    { method: "get", args: { userId: "user-1", postId: "p1" } },
    { method: "confirm", args: { userId: "user-1", postId: "p2", confirmationToken: "tok" } },
    {
      method: "reschedule",
      args: { userId: "user-1", postId: "p3", schedule: { mode: "at", localDateTime: "2026-10-22T10:00:00", timezone: "UTC" } },
    },
    { method: "cancel", args: { userId: "user-1", postId: "p4" } },
  ]);
});

test("malformed JSON and non-strict bodies return 422 without calling the core", async () => {
  const { core, calls } = fakeCore();
  const d = deps(core);
  const responses = [
    await createPostsHandlers(d).POST(jsonRequest("", "{not json")),
    await createPostsHandlers(d).POST(jsonRequest("", JSON.stringify({ ...previewBody, userId: "user-2" }))),
    await createPostsHandlers(d).POST(jsonRequest("", "[]")),
    await createConfirmHandler(d)(jsonRequest("/p/confirm", "{"), params("p")),
    await createConfirmHandler(d)(jsonRequest("/p/confirm", '{"confirmationToken":"t","userId":"x"}'), params("p")),
    await createRescheduleHandler(d)(jsonRequest("/p/reschedule", '{"schedule":{"mode":"later"}}'), params("p")),
    await createRescheduleHandler(d)(jsonRequest("/p/reschedule", "nope"), params("p")),
  ];
  for (const response of responses) {
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "INVALID_INPUT");
  }
  assert.deepEqual(calls, []);
});

test("core error codes map to HTTP statuses", async () => {
  const expected: [QueueErrorCode | "UNEXPECTED", number][] = [
    ["INVALID_INPUT", 422],
    ["STAGED_VIDEO_INVALID", 422],
    ["ACCOUNT_NOT_CONNECTED", 409],
    ["NOT_FOUND", 404],
    ["INVALID_STATE", 409],
    ["CONFIRMATION_INVALID", 403],
    ["CONFIRMATION_EXPIRED", 403],
    ["UNEXPECTED", 500],
  ];
  for (const [code, status] of expected) {
    const { core } = fakeCore({ ok: false, error: { code, message: "details" } });
    const response = await createConfirmHandler(deps(core))(jsonRequest("/p/confirm", '{"confirmationToken":"t"}'), params("p"));
    assert.equal(response.status, status, code);
    assert.deepEqual(await response.json(), status === 500 ? { error: "INTERNAL_ERROR" } : { error: code, message: "details" });
  }
});

test("thrown core failures become an opaque 500", async () => {
  const core = { get: async () => { throw new Error("database path /secret"); } } as unknown as SocialQueueCore;
  const response = await createPostHandlers(deps(core)).GET(new Request("http://localhost/api/social/posts/p"), params("p"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "INTERNAL_ERROR" });
});
