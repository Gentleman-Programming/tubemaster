import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "@/lib/video-metadata/contracts";
import { createMultiUploadPostHandler } from "./route";

const request = (body: string) => new Request("http://localhost/api/youtube/upload/multi", { method: "POST", body });

test("requires a session and does not expose provider details", async () => {
  let calls = 0;
  const upload = async () => { calls++; return {}; };
  assert.equal((await createMultiUploadPostHandler({ getSession: async () => null, upload })(request("{}"))).status, 401);
  assert.equal((await createMultiUploadPostHandler({ getSession: async () => ({ user: { id: "user" } }), upload })(request("{"))).status, 400);
  assert.equal(calls, 0);

  const uncertain = createMultiUploadPostHandler({
    getSession: async () => ({ user: { id: "user" } }),
    upload: async () => { throw new DomainError({ code: "update_failed", message: "secret", details: { operationId: "op", outcome: "unknown", filePath: "/secret" } }); },
  });
  assert.deepEqual(await (await uncertain(request("{}"))).json(), { error: "update_failed", outcome: "unknown", operationId: "op", retryAutomatically: false });
});

test("returns the ordered collection result", async () => {
  const handler = createMultiUploadPostHandler({
    getSession: async () => ({ user: { id: "user" } }),
    upload: async () => ({ status: "completed", operationId: "batch", channelId: "channel", items: [
      { index: 0, fileSha256: "a", status: "uploaded", videoId: "video-1" },
      { index: 1, fileSha256: "b", status: "unknown", retryAutomatically: false },
    ], dryRun: false }),
  });
  assert.deepEqual(await (await handler(request("{}"))).json(), {
    status: "completed", operationId: "batch", channelId: "channel", items: [
      { index: 0, fileSha256: "a", status: "uploaded", videoId: "video-1" },
      { index: 1, fileSha256: "b", status: "unknown", retryAutomatically: false },
    ], dryRun: false,
  });
});
