import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { SQLiteAuditRepository, type AuditEventInput } from "./repository";

const NOW = new Date("2026-01-31T12:00:00.000Z");

function event(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    userId: "user-1",
    operationId: "op-1",
    event: "video_metadata.list.success",
    timestamp: NOW,
    context: { operationId: "op-1", count: 2 },
    ...overrides,
  };
}

test("audit repository initializes idempotently, stores sanitized event data, and isolates users", async () => {
  const client = createClient({ url: ":memory:" });
  const repository = new SQLiteAuditRepository(client);
  await repository.initialize();
  await repository.initialize();
  await repository.append(event());
  await repository.append(event({ userId: "user-2", operationId: "op-2", context: { operationId: "op-2" } }));

  assert.deepEqual(await repository.listForUser("user-1"), [{
    id: 1,
    userId: "user-1",
    operationId: "op-1",
    event: "video_metadata.list.success",
    timestamp: NOW.toISOString(),
    context: { operationId: "op-1", count: 2 },
  }]);
  assert.equal((await repository.listForUser("user-2"))[0]?.operationId, "op-2");
  assert.deepEqual(await repository.listForUser("other-user"), []);
});

test("audit repository purges only events older than the fixed retention cutoff", async () => {
  const client = createClient({ url: ":memory:" });
  const repository = new SQLiteAuditRepository(client);
  await repository.initialize();
  await repository.append(event({ timestamp: new Date("2025-11-02T11:59:59.000Z") }));
  await repository.append(event({ operationId: "boundary", timestamp: new Date("2025-11-02T12:00:00.000Z"), context: { operationId: "boundary" } }));
  await repository.append(event({ operationId: "new", timestamp: new Date("2026-01-31T11:59:59.000Z"), context: { operationId: "new" } }));

  assert.equal(await repository.purgeExpired(NOW), 1);
  assert.deepEqual((await repository.listForUser("user-1")).map((item) => item.operationId), ["boundary", "new"]);
  assert.equal(await repository.purgeExpired(NOW), 0);
});
