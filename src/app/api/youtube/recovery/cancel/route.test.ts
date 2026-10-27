import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecoveryCancelPostHandler } from "./route";

const request = (body: string) => new Request("http://localhost/api/youtube/recovery/cancel", { method: "POST", body });

test("cancel requires a session and returns the confirmed recovery result", async () => {
  let received: unknown;
  const cancel = createRecoveryCancelPostHandler({ getSession: async () => ({ user: { id: "owner" } }), cancel: async (_user, body) => { received = body; return { status: "cancelled", operationId: "op", recoveryOperationId: "recovery", videoId: "video", channelId: "channel", privacyStatus: "private", dryRun: false }; } });
  assert.deepEqual(await (await cancel(request(JSON.stringify({ expectedChannelId: "channel", operationId: "op", videoId: "video", dryRun: false, confirmed: true, confirmationToken: "token" })))).json(), { status: "cancelled", operationId: "op", recoveryOperationId: "recovery", videoId: "video", channelId: "channel", privacyStatus: "private", dryRun: false });
  assert.deepEqual(received, { expectedChannelId: "channel", operationId: "op", videoId: "video", dryRun: false, confirmed: true, confirmationToken: "token", credentialRef: { userId: "owner" } });
  assert.equal((await createRecoveryCancelPostHandler({ getSession: async () => null, cancel: async () => ({}) })(request("{}"))).status, 401);
});
