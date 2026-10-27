import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecoveryBatchReconcilePostHandler } from "./route";

test("multi reconciliation preserves ordered item results", async () => {
  let received: unknown;
  const handler = createRecoveryBatchReconcilePostHandler({
    getSession: async () => ({ user: { id: "owner" } }),
    reconcileMany: async (_user, body) => { received = body; return { status: "completed", channelId: "channel", items: [{ index: 0, status: "absent", operationId: "first", channelId: "channel" }] }; },
  });
  const response = await handler(new Request("http://localhost/api/youtube/recovery/reconcile/multi", { method: "POST", body: JSON.stringify({ expectedChannelId: "channel", items: [{ operationId: "first" }] }) }));
  assert.deepEqual(await response.json(), { status: "completed", channelId: "channel", items: [{ index: 0, status: "absent", operationId: "first", channelId: "channel" }] });
  assert.deepEqual(received, { expectedChannelId: "channel", items: [{ operationId: "first" }], credentialRef: { userId: "owner" } });
});
