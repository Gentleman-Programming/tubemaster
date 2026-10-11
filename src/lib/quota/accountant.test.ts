import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { SQLiteQuotaRepository } from "./repository";
import test from "node:test";
import {
  InMemoryQuotaAccountant,
  createDurableQuotaAccountant,
  YOUTUBE_QUOTA_COSTS,
  getQuotaBucketStart,
  resolveQuotaTimezone,
  type QuotaOperation,
} from "./accountant";

test("in-memory quota accountant records safe entries and accumulates repeated calls", () => {
  const accountant = new InMemoryQuotaAccountant();

  accountant.record({ operationId: "operation-1", operation: "videos.list" });
  accountant.record({ operationId: "operation-1", operation: "videos.update" });
  accountant.record({ operationId: "operation-2", operation: "videos.list" });
  accountant.record({
    operationId: "operation-3",
    operation: "videos.list",
    channelId: "UC_ACTIVE",
  });

  const entries = accountant.entries();
  assert.equal(entries.length, 4);
  assert.deepEqual(
    entries.map(({ operationId, operation, estimatedUnits, channelId }) => ({
      operationId,
      operation,
      estimatedUnits,
      ...(channelId ? { channelId } : {}),
    })),
    [
      { operationId: "operation-1", operation: "videos.list", estimatedUnits: 1 },
      { operationId: "operation-1", operation: "videos.update", estimatedUnits: 50 },
      { operationId: "operation-2", operation: "videos.list", estimatedUnits: 1 },
      {
        operationId: "operation-3",
        operation: "videos.list",
        estimatedUnits: 1,
        channelId: "UC_ACTIVE",
      },
    ],
  );
  for (const entry of entries) {
    assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(
      Object.keys(entry).sort(),
      entry.channelId
        ? ["channelId", "estimatedUnits", "operation", "operationId", "timestamp"]
        : ["estimatedUnits", "operation", "operationId", "timestamp"],
    );
  }
  assert.equal(entries[3]?.channelId, "UC_ACTIVE");
  (entries[0] as { operationId: string }).operationId = "changed";
  assert.equal(accountant.entries()[0].operationId, "operation-1");
});

test("durable entries aggregate by bucket and isolate user/global scopes", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    const repository = new SQLiteQuotaRepository(client);
    await repository.initialize();
    const now = () => new Date("2026-01-02T07:30:00.000Z");
    const user = createDurableQuotaAccountant({ client, scope: { kind: "user", userId: "a" }, now });
    const other = createDurableQuotaAccountant({ client, scope: { kind: "user", userId: "b" }, now });
    const global = createDurableQuotaAccountant({ client, scope: { kind: "global" }, now });
    user.record({ operationId: "same", operation: "videos.list" });
    user.record({ operationId: "same", operation: "videos.update" });
    other.record({ operationId: "same", operation: "videos.list" });
    global.record({ operationId: "same", operation: "captions.download" });
    // Await the client's query after inserts have been scheduled on the same connection.
    assert.equal(await repository.total({ kind: "user", userId: "a" }, "2026-01-01"), 51);
    assert.equal(await repository.total({ kind: "user", userId: "b" }, "2026-01-01"), 1);
    assert.equal(await repository.total({ kind: "global" }, "2026-01-01"), 200);
    assert.equal(await repository.total({ kind: "user", userId: "a" }, "2026-01-02"), 0);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM quota_entries")).rows[0].count, 4);
  } finally {
    client.close();
  }
});

test("durable record isolates synchronous and rejected persistence failures", async () => {
  const entry = { operationId: "op", operation: "videos.list" as const };
  const sync = createDurableQuotaAccountant({
    client: { execute: () => { throw new Error("offline"); } } as never,
    scope: { kind: "global" },
  });
  assert.doesNotThrow(() => sync.record(entry));
  const rejected = createDurableQuotaAccountant({
    client: { execute: () => Promise.reject(new Error("offline")) } as never,
    scope: { kind: "global" },
  });
  assert.doesNotThrow(() => rejected.record(entry));
  await new Promise((resolve) => setImmediate(resolve));
});

test("explicit YouTube costs cover every supported operation", () => {
  const expected: Record<QuotaOperation, number> = {
    "channels.list": 1,
    "videos.list": 1,
    "videos.update": 50,
    "playlists.list": 1,
    "playlists.insert": 50,
    "playlists.update": 50,
    "playlists.delete": 50,
    "playlistItems.list": 1,
    "playlistItems.insert": 50,
    "playlistItems.delete": 50,
    "captions.list": 50,
    "captions.download": 200,
    "reports.query": 1,
  };
  assert.deepEqual(YOUTUBE_QUOTA_COSTS, expected);
});

test("quota bucket timezone defaults safely and is deterministic", () => {
  assert.equal(resolveQuotaTimezone(), "America/Los_Angeles");
  assert.equal(resolveQuotaTimezone("not-a-timezone"), "UTC");
  assert.equal(resolveQuotaTimezone("UTC"), "UTC");
  assert.equal(
    getQuotaBucketStart(new Date("2026-01-02T07:30:00.000Z"), "America/Los_Angeles"),
    "2026-01-01",
  );
  assert.equal(
    getQuotaBucketStart(new Date("2026-01-02T08:30:00.000Z"), "America/Los_Angeles"),
    "2026-01-02",
  );
  assert.equal(getQuotaBucketStart(new Date("2026-01-02T07:30:00.000Z"), "UTC"), "2026-01-02");
});
