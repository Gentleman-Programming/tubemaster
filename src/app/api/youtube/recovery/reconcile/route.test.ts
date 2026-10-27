import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "@/lib/video-metadata/contracts";
import { createRecoveryReconcilePostHandler } from "./route";

const request = (body: string) => new Request("http://localhost/api/youtube/recovery/reconcile", { method: "POST", body });

test("reconcile requires a session and binds the session user", async () => {
  let received: unknown;
  const reconcile = createRecoveryReconcilePostHandler({ getSession: async () => ({ user: { id: "owner" } }), reconcile: async (_user, body) => { received = body; return { status: "unknown", operationId: "op", channelId: "channel", reason: "ambiguous", retryAutomatically: false }; } });
  assert.deepEqual(await (await reconcile(request(JSON.stringify({ expectedChannelId: "channel", operationId: "op" })))).json(), { status: "unknown", operationId: "op", channelId: "channel", reason: "ambiguous", retryAutomatically: false });
  assert.deepEqual(received, { expectedChannelId: "channel", operationId: "op", credentialRef: { userId: "owner" } });
  assert.equal((await createRecoveryReconcilePostHandler({ getSession: async () => null, reconcile: async () => ({}) })(request("{}"))).status, 401);
});

test("reconcile maps uncertain and unexpected errors safely", async () => {
  const uncertain = createRecoveryReconcilePostHandler({ getSession: async () => ({ user: { id: "owner" } }), reconcile: async () => { throw new DomainError({ code: "update_failed", message: "secret", details: { operationId: "op", outcome: "unknown" } }); } });
  assert.deepEqual(await (await uncertain(request("{}"))).json(), { error: "update_failed", outcome: "unknown", operationId: "op", retryAutomatically: false });
  const unexpected = createRecoveryReconcilePostHandler({ getSession: async () => ({ user: { id: "owner" } }), reconcile: async () => { throw new Error("secret"); } });
  assert.deepEqual(await (await unexpected(request("{}"))).json(), { error: "internal_error" });
});
