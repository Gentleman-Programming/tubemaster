import assert from "node:assert/strict";
import { test } from "node:test";
import type { Client } from "@libsql/client";
import { createQuotaUsageGetHandler } from "./route";
import { SQLiteQuotaRepository } from "@/lib/quota/repository";

test("usage route authenticates before querying and forces session scope", async () => {
  let calls = 0;
  const summaries = async (userId: string, filters: object) => {
    calls++;
    assert.equal(userId, "session-user");
    assert.deepEqual(filters, { bucketStart: "2026-04-01", operation: "videos.list", operationId: "op-1" });
    return [{ bucketStart: "2026-04-01", operation: "videos.list" as const, estimatedUnits: 2, operationCount: 2 }];
  };
  const unauthorized = createQuotaUsageGetHandler({ getSession: async () => null, summaries });
  const request = new Request("http://localhost/api/quota/usage?bucketStart=2026-04-01&operation=videos.list&operationId=op-1");
  assert.equal((await unauthorized(request)).status, 401);
  assert.equal(calls, 0);
  const authenticated = createQuotaUsageGetHandler({ getSession: async () => ({ user: { id: "session-user" } }), summaries });
  const response = await authenticated(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { summaries: [{ bucketStart: "2026-04-01", operation: "videos.list", estimatedUnits: 2, operationCount: 2 }] });
});

test("usage forwards all, unassigned, and explicit channel filters", async () => {
  const received: object[] = [];
  const handler = createQuotaUsageGetHandler({
    getSession: async () => ({ user: { id: "user" } }),
    summaries: async (_userId, filters) => {
      received.push(filters);
      return [];
    },
  });

  for (const [query, expected] of [
    ["", {}],
    ["channelId=all", {}],
    ["channelId=null", { channelId: null }],
    ["channelId=unassigned", { channelId: null }],
    ["channelId=channel_a-1", { channelId: "channel_a-1" }],
  ] as const) {
    assert.equal((await handler(new Request(`http://localhost/api/quota/usage?${query}`))).status, 200);
    assert.deepEqual(received.at(-1), expected);
  }
});

test("usage rejects unknown, duplicated, and malformed filters without repository access", async () => {
  const handler = createQuotaUsageGetHandler({
    getSession: async () => ({ user: { id: "user" } }),
    summaries: async () => { throw new Error("unexpected access"); },
  });
  for (const query of ["scope=global", "userId=other", "operation=unknown", "operation=videos.list&operation=videos.list", "bucketStart=2026-02-30", "bucketStart=2026-2-01", "operationId=", "operationId=bad%20id", "channelId=", "channelId=bad%20id", "channelId=channel/a"]) {
    const response = await handler(new Request(`http://localhost/api/quota/usage?${query}`));
    assert.equal(response.status, 422, query);
    assert.deepEqual(await response.json(), { error: "Invalid quota usage query", code: "INVALID_INPUT" });
  }
});

test("usage hides repository errors", async () => {
  const handler = createQuotaUsageGetHandler({
    getSession: async () => ({ user: { id: "user" } }),
    summaries: async () => { throw new Error("database secret"); },
  });
  const response = await handler(new Request("http://localhost/api/quota/usage"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Unable to load quota usage" });
});

test("repository aggregates only exact scope and parameterizes filters", async () => {
  const calls: { sql: string; args: unknown[] }[] = [];
  const client = { execute: async (statement: { sql: string; args: unknown[] }) => {
    calls.push(statement);
    return { rows: [{ bucket_start: "2026-04-01", operation: "videos.list", channel_id: "channel-a", units: 3, entries: 2 }] };
  } } as unknown as Pick<Client, "execute">;
  const repo = new SQLiteQuotaRepository(client);
  assert.deepEqual(await repo.summarize({ kind: "user", userId: "u1" }, { bucketStart: "2026-04-01", operation: "videos.list", operationId: "op-1", channelId: "channel-a" }),
    [{ bucketStart: "2026-04-01", operation: "videos.list", channelId: "channel-a", estimatedUnits: 3, operationCount: 2 }]);
  assert.deepEqual(calls[0].args, ["user", "u1", "2026-04-01", "videos.list", "op-1", "channel-a"]);
  assert.match(calls[0].sql, /scope_kind = \? AND user_id IS \?/);
  assert.match(calls[0].sql, /channel_id IS \?/);
  assert.doesNotMatch(calls[0].sql, /op-1|u1/);
  await repo.summarize({ kind: "global" });
  assert.deepEqual(calls[1].args, ["global", null]);
});
