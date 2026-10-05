import assert from "node:assert/strict";
import test from "node:test";
import { createChannelInfoGetHandler } from "./route";

const channel = {
  id: "channel-1",
  snippet: { title: "Channel", thumbnails: { default: { url: "thumb" } } },
  statistics: { videoCount: "3" },
};

function makeDeps(options: {
  record?: () => void;
  list?: () => Promise<{ data: { items: (typeof channel)[] } }>;
}) {
  const records: Array<{ operationId: string; operation: string }> = [];
  return {
    records,
    deps: {
      getSession: async () => ({ user: { id: "user-1" } }),
      getYoutube: async () => ({
        channels: {
          list: options.list ?? (async () => ({ data: { items: [channel] } })),
        },
      }),
      createAccountant: () => ({
        record(entry: { operationId: string; operation: string }) {
          records.push(entry);
          options.record?.();
        },
      }),
      operationIdFactory: () => "channel-info-operation",
    } as unknown as Parameters<typeof createChannelInfoGetHandler>[0],
  };
}

test("channel info accounts a successful channels.list request", async () => {
  const fixture = makeDeps({});
  const response = await createChannelInfoGetHandler(fixture.deps)();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    channel: {
      id: "channel-1",
      title: "Channel",
      thumbnail: "thumb",
      videoCount: "3",
    },
  });
  assert.deepEqual(fixture.records, [
    { operationId: "channel-info-operation", operation: "channels.list" },
  ]);
});

test("channel info sanitizes provider failures after accounting the attempt", async () => {
  const fixture = makeDeps({
    list: async () => { throw new Error("provider failure"); },
  });
  const response = await createChannelInfoGetHandler(fixture.deps)();

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "internal_error",
    message: "Internal server error",
  });
  assert.deepEqual(fixture.records, [
    { operationId: "channel-info-operation", operation: "channels.list" },
  ]);
});

test("channel info does not mask success or failure when accounting fails", async () => {
  const success = makeDeps({ record: () => { throw new Error("accounting failure"); } });
  const successResponse = await createChannelInfoGetHandler(success.deps)();
  assert.equal(successResponse.status, 200);
  assert.equal((await successResponse.json()).channel.id, "channel-1");

  const failure = makeDeps({
    record: () => { throw new Error("accounting failure"); },
    list: async () => { throw new Error("provider failure"); },
  });
  const failureResponse = await createChannelInfoGetHandler(failure.deps)();
  assert.equal(failureResponse.status, 500);
  assert.deepEqual(await failureResponse.json(), {
    error: "internal_error",
    message: "Internal server error",
  });
});
