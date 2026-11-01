import type { Client } from "@libsql/client";
import type { QuotaEntry, QuotaOperation } from "./accountant";

export type QuotaUsageSummary = {
  bucketStart: string;
  operation: QuotaOperation;
  channelId?: string | null;
  operationCount: number;
  estimatedUnits: number;
};

export type QuotaUsageFilter = {
  bucketStart?: string;
  operation?: QuotaOperation;
  operationId?: string;
  channelId?: string | null;
};

export type QuotaScope =
  | { kind: "global" }
  | { kind: "user"; userId: string };

export type StoredQuotaEntry = QuotaEntry & {
  scope: QuotaScope;
  bucketStart: string;
};

/** Explicit initialization keeps importing this module free of database side effects. */
export class SQLiteQuotaRepository {
  constructor(private readonly client: Pick<Client, "execute">) {}

  async initialize(): Promise<void> {
    await this.client.execute(`CREATE TABLE IF NOT EXISTS quota_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_kind TEXT NOT NULL,
      user_id TEXT,
      operation_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      estimated_units INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      bucket_start TEXT NOT NULL,
      channel_id TEXT
    )`);
    const columns = await this.client.execute("PRAGMA table_info(quota_entries)");
    if (!columns.rows.some((row) => row.name === "channel_id")) {
      await this.client.execute("ALTER TABLE quota_entries ADD COLUMN channel_id TEXT");
    }
  }

  async append(entry: StoredQuotaEntry): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO quota_entries
        (scope_kind, user_id, operation_id, operation, estimated_units, timestamp, bucket_start, channel_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [entry.scope.kind, entry.scope.kind === "user" ? entry.scope.userId : null,
        entry.operationId, entry.operation, entry.estimatedUnits, entry.timestamp, entry.bucketStart,
        entry.channelId ?? null],
    });
  }

  async summarize(
    scope: QuotaScope,
    filters: QuotaUsageFilter = {},
  ): Promise<QuotaUsageSummary[]> {
    const clauses = ["scope_kind = ?", "user_id IS ?"];
    const args: (string | null)[] = [scope.kind, scope.kind === "user" ? scope.userId : null];
    if (filters.bucketStart !== undefined) {
      clauses.push("bucket_start = ?");
      args.push(filters.bucketStart);
    }
    if (filters.operation !== undefined) {
      clauses.push("operation = ?");
      args.push(filters.operation);
    }
    if (filters.operationId !== undefined) {
      clauses.push("operation_id = ?");
      args.push(filters.operationId);
    }
    if (filters.channelId !== undefined) {
      clauses.push("channel_id IS ?");
      args.push(filters.channelId);
    }
    const result = await this.client.execute({
      sql: `SELECT bucket_start, operation, channel_id, SUM(estimated_units) AS units, COUNT(*) AS entries
        FROM quota_entries WHERE ${clauses.join(" AND ")}
        GROUP BY bucket_start, operation, channel_id ORDER BY bucket_start, operation, channel_id`,
      args,
    });
    return result.rows.map((row) => ({
      bucketStart: String(row.bucket_start),
      operation: String(row.operation) as QuotaOperation,
      channelId: row.channel_id == null ? null : String(row.channel_id),
      operationCount: Number(row.entries),
      estimatedUnits: Number(row.units),
    }));
  }

  /** Compatibility alias for callers that prefer collection-oriented naming. */
  async summaries(
    scope: QuotaScope,
    filters: QuotaUsageFilter = {},
  ): Promise<QuotaUsageSummary[]> {
    return this.summarize(scope, filters);
  }

  async total(scope: QuotaScope, bucketStart: string): Promise<number> {
    const result = await this.client.execute({
      sql: `SELECT COALESCE(SUM(estimated_units), 0) AS units FROM quota_entries
        WHERE scope_kind = ? AND user_id IS ? AND bucket_start = ?`,
      args: [scope.kind, scope.kind === "user" ? scope.userId : null, bucketStart],
    });
    return Number(result.rows[0]?.units ?? 0);
  }
}
