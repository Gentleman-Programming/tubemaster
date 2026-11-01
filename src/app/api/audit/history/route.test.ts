import assert from "node:assert/strict";
import test from "node:test";
import { createAuditHistoryGetHandler } from "./route";

const event = {
  id: 1,
  userId: "user-1",
  operationId: "op-1",
  event: "video_metadata.list.success",
  timestamp: "2026-01-31T12:00:00.000Z",
  context: { operationId: "op-1", count: 2 },
};

test("audit history requires authentication and scopes reads to the session user", async () => {
  let requestedUser = "";
  const handler = createAuditHistoryGetHandler({
    getSession: async () => ({ user: { id: "user-1" } }),
    repository: {
      purgeExpired: async () => 0,
      listForUser: async (userId: string) => { requestedUser = userId; return [event]; },
    },
  });

  const unauthorized = await createAuditHistoryGetHandler({
    getSession: async () => null,
    repository: { purgeExpired: async () => 0, listForUser: async () => [event] },
  })(new Request("http://localhost/api/audit/history"));
  assert.equal(unauthorized.status, 401);

  const response = await handler(new Request("http://localhost/api/audit/history?limit=10"));
  assert.equal(response.status, 200);
  assert.equal(requestedUser, "user-1");
  assert.deepEqual(await response.json(), { events: [event] });
});

test("audit history rejects unsafe query parameters before repository access", async () => {
  let accessed = false;
  const handler = createAuditHistoryGetHandler({
    getSession: async () => ({ user: { id: "user-1" } }),
    repository: {
      purgeExpired: async () => { accessed = true; return 0; },
      listForUser: async () => { accessed = true; return []; },
    },
  });

  const response = await handler(new Request("http://localhost/api/audit/history?userId=other"));
  assert.equal(response.status, 422);
  assert.equal(accessed, false);
});
