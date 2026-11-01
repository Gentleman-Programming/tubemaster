import type { Client } from "@libsql/client";

export const AUDIT_RETENTION_DAYS = 90;

export type AuditEventInput = {
  userId: string | null;
  operationId: string;
  event: string;
  timestamp: Date;
  context: Record<string, string | number | boolean>;
};

export type AuditEventRecord = Omit<AuditEventInput, "timestamp"> & {
  id: number;
  timestamp: string;
};

function toRecord(row: Record<string, unknown>): AuditEventRecord {
  return {
    id: Number(row.id),
    userId: row.user_id === null ? null : String(row.user_id),
    operationId: String(row.operation_id),
    event: String(row.event),
    timestamp: String(row.timestamp),
    context: JSON.parse(String(row.context_json)) as Record<string, string | number | boolean>,
  };
}

export class SQLiteAuditRepository {
  constructor(private readonly client: Pick<Client, "execute">) {}

  async initialize(): Promise<void> {
    await this.client.execute(`CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      operation_id TEXT NOT NULL,
      event TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      context_json TEXT NOT NULL
    )`);
    await this.client.execute("CREATE INDEX IF NOT EXISTS audit_events_user_timestamp ON audit_events (user_id, timestamp, id)");
  }

  async append(input: AuditEventInput): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO audit_events (user_id, operation_id, event, timestamp, context_json)
        VALUES (?, ?, ?, ?, ?)`,
      args: [
        input.userId,
        input.operationId,
        input.event,
        input.timestamp.toISOString(),
        JSON.stringify(input.context),
      ],
    });
  }

  async listForUser(userId: string, limit = 100): Promise<AuditEventRecord[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const result = await this.client.execute({
      sql: `SELECT id, user_id, operation_id, event, timestamp, context_json
        FROM audit_events WHERE user_id = ? ORDER BY id ASC LIMIT ?`,
      args: [userId, safeLimit],
    });
    return result.rows.map((row) => toRecord(row as Record<string, unknown>));
  }

  async purgeExpired(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const result = await this.client.execute({
      sql: "DELETE FROM audit_events WHERE timestamp < ?",
      args: [cutoff],
    });
    return result.rowsAffected ?? 0;
  }
}
