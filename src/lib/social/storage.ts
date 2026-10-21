import { randomUUID } from "node:crypto";
import type { Client, InStatement, Row } from "@libsql/client";
import {
  isSocialPlatform,
  isSocialPostStatus,
  type JsonObject,
  type NewSocialPost,
  type SocialAccount,
  type SocialAccountProfile,
  type SocialAccountTokens,
  type SocialPlatform,
  type SocialPost,
  type SocialPostFilter,
  type SocialPostStatus,
  type SocialPostTransitionPatch,
} from "./contracts";
import { decryptToken, encryptToken } from "./token-crypto";

type SqlClient = Pick<Client, "execute">;
type SqlValue = string | number | null;

const SOCIAL_DDL = [
  `CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    external_account_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    scopes TEXT NOT NULL,
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT,
    token_expires_at TEXT,
    connected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, platform)
  )`,
  `CREATE TABLE IF NOT EXISTS social_posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    staging_file TEXT NOT NULL,
    caption TEXT NOT NULL,
    platform_options TEXT NOT NULL DEFAULT '{}',
    scheduled_at_utc TEXT NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL,
    external_post_id TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    confirmed_sha256 TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_social_posts_status_scheduled
    ON social_posts (status, scheduled_at_utc)`,
];

/**
 * Idempotent DDL. Pass the raw (non-gated) client when calling from database initialization,
 * otherwise the init-gating proxy would wait on itself.
 */
export async function initializeSocialTables(client: SqlClient): Promise<void> {
  for (const statement of SOCIAL_DDL) {
    await client.execute(statement);
  }
  // Migration: add confirmed_sha256 to tables created before it existed (idempotent)
  try {
    await client.execute("ALTER TABLE social_posts ADD COLUMN confirmed_sha256 TEXT");
  } catch (error) {
    if (!/duplicate column/i.test(error instanceof Error ? error.message : String(error))) throw error;
  }
}

function assertPlatform(value: unknown): asserts value is SocialPlatform {
  if (!isSocialPlatform(value)) throw new Error(`Unknown social platform: ${String(value)}`);
}

function assertStatus(value: unknown): asserts value is SocialPostStatus {
  if (!isSocialPostStatus(value)) throw new Error(`Unknown social post status: ${String(value)}`);
}

function optionalString(value: Row[string]): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function toAccount(row: Row): SocialAccount {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    platform: String(row.platform) as SocialPlatform,
    externalAccountId: String(row.external_account_id),
    displayName: String(row.display_name),
    scopes: JSON.parse(String(row.scopes)) as string[],
    tokenExpiresAt: optionalString(row.token_expires_at) ?? null,
    connectedAt: String(row.connected_at),
  };
}

function toPost(row: Row): SocialPost {
  const post: SocialPost = {
    id: String(row.id),
    userId: String(row.user_id),
    accountId: String(row.account_id),
    platform: String(row.platform) as SocialPlatform,
    stagingFile: String(row.staging_file),
    caption: String(row.caption),
    platformOptions: JSON.parse(String(row.platform_options)) as JsonObject,
    scheduledAtUtc: String(row.scheduled_at_utc),
    timezone: String(row.timezone),
    status: String(row.status) as SocialPostStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  const externalPostId = optionalString(row.external_post_id);
  if (externalPostId !== undefined) post.externalPostId = externalPostId;
  const errorCode = optionalString(row.error_code);
  if (errorCode !== undefined) {
    post.error = { code: errorCode, message: optionalString(row.error_message) ?? "" };
  }
  const publishedAt = optionalString(row.published_at);
  if (publishedAt !== undefined) post.publishedAt = publishedAt;
  const confirmedSha256 = optionalString(row.confirmed_sha256);
  if (confirmedSha256 !== undefined) post.confirmedSha256 = confirmedSha256;
  return post;
}

const ACCOUNT_COLUMNS =
  "id, user_id, platform, external_account_id, display_name, scopes, token_expires_at, connected_at";

export type SocialStorageOptions = {
  client: SqlClient;
  secret: string; // Callers pass NEXTAUTH_SECRET.
  now?: () => Date;
};

export function createSocialStorage({ client, secret, now = () => new Date() }: SocialStorageOptions) {
  const timestamp = () => now().toISOString();
  const encrypt = (token: string) => encryptToken(token, secret);

  async function queryRows(statement: InStatement): Promise<Row[]> {
    return (await client.execute(statement)).rows;
  }

  async function getAccount(userId: string, platform: SocialPlatform): Promise<SocialAccount | null> {
    assertPlatform(platform);
    const [row] = await queryRows({
      sql: `SELECT ${ACCOUNT_COLUMNS} FROM social_accounts WHERE user_id = ? AND platform = ?`,
      args: [userId, platform],
    });
    return row ? toAccount(row) : null;
  }

  /** Reconnecting the same platform replaces the profile and all tokens of the existing row. */
  async function upsertAccount(
    userId: string,
    platform: SocialPlatform,
    profile: SocialAccountProfile,
    tokens: SocialAccountTokens,
  ): Promise<SocialAccount> {
    assertPlatform(platform);
    const connectedAt = timestamp();
    await client.execute({
      sql: `INSERT INTO social_accounts
        (id, user_id, platform, external_account_id, display_name, scopes,
         access_token_enc, refresh_token_enc, token_expires_at, connected_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, platform) DO UPDATE SET
          external_account_id = excluded.external_account_id,
          display_name = excluded.display_name,
          scopes = excluded.scopes,
          access_token_enc = excluded.access_token_enc,
          refresh_token_enc = excluded.refresh_token_enc,
          token_expires_at = excluded.token_expires_at,
          connected_at = excluded.connected_at,
          updated_at = excluded.updated_at`,
      args: [
        randomUUID(), userId, platform, profile.externalAccountId, profile.displayName,
        JSON.stringify(profile.scopes), encrypt(tokens.accessToken),
        tokens.refreshToken === undefined ? null : encrypt(tokens.refreshToken),
        tokens.expiresAt ?? null, connectedAt, connectedAt,
      ],
    });
    const account = await getAccount(userId, platform);
    if (!account) throw new Error("Social account upsert did not persist");
    return account;
  }

  async function getAccountTokens(accountId: string): Promise<SocialAccountTokens | null> {
    const [row] = await queryRows({
      sql: "SELECT access_token_enc, refresh_token_enc, token_expires_at FROM social_accounts WHERE id = ?",
      args: [accountId],
    });
    if (!row) return null;
    const tokens: SocialAccountTokens = { accessToken: decryptToken(String(row.access_token_enc), secret) };
    const refreshToken = optionalString(row.refresh_token_enc);
    if (refreshToken !== undefined) tokens.refreshToken = decryptToken(refreshToken, secret);
    const expiresAt = optionalString(row.token_expires_at);
    if (expiresAt !== undefined) tokens.expiresAt = expiresAt;
    return tokens;
  }

  /** Refresh responses may omit the refresh token; the stored one is kept in that case. */
  async function updateAccountTokens(accountId: string, tokens: SocialAccountTokens): Promise<boolean> {
    const result = await client.execute({
      sql: `UPDATE social_accounts SET
        access_token_enc = ?,
        refresh_token_enc = COALESCE(?, refresh_token_enc),
        token_expires_at = ?,
        updated_at = ?
        WHERE id = ?`,
      args: [
        encrypt(tokens.accessToken),
        tokens.refreshToken === undefined ? null : encrypt(tokens.refreshToken),
        tokens.expiresAt ?? null, timestamp(), accountId,
      ],
    });
    return result.rowsAffected > 0;
  }

  async function deleteAccount(userId: string, platform: SocialPlatform): Promise<boolean> {
    assertPlatform(platform);
    const result = await client.execute({
      sql: "DELETE FROM social_accounts WHERE user_id = ? AND platform = ?",
      args: [userId, platform],
    });
    return result.rowsAffected > 0;
  }

  async function listAccounts(userId: string): Promise<SocialAccount[]> {
    const rows = await queryRows({
      sql: `SELECT ${ACCOUNT_COLUMNS} FROM social_accounts WHERE user_id = ? ORDER BY platform`,
      args: [userId],
    });
    return rows.map(toAccount);
  }

  async function insertPost(input: NewSocialPost): Promise<SocialPost> {
    assertPlatform(input.platform);
    assertStatus(input.status);
    const options = input.platformOptions;
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new Error("Social post platformOptions must be a JSON object");
    }
    const id = randomUUID();
    const createdAt = timestamp();
    await client.execute({
      sql: `INSERT INTO social_posts
        (id, user_id, account_id, platform, staging_file, caption, platform_options,
         scheduled_at_utc, timezone, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, input.userId, input.accountId, input.platform, input.stagingFile, input.caption,
        JSON.stringify(options), input.scheduledAtUtc, input.timezone, input.status, createdAt, createdAt,
      ],
    });
    const post = await getPost(input.userId, id);
    if (!post) throw new Error("Social post insert did not persist");
    return post;
  }

  async function getPost(userId: string, id: string): Promise<SocialPost | null> {
    const [row] = await queryRows({
      sql: "SELECT * FROM social_posts WHERE user_id = ? AND id = ?",
      args: [userId, id],
    });
    return row ? toPost(row) : null;
  }

  async function listPosts(userId: string, filter: SocialPostFilter = {}): Promise<SocialPost[]> {
    const clauses = ["user_id = ?"];
    const args: SqlValue[] = [userId];
    if (filter.statuses !== undefined) {
      filter.statuses.forEach(assertStatus);
      if (filter.statuses.length === 0) return [];
      clauses.push(`status IN (${filter.statuses.map(() => "?").join(", ")})`);
      args.push(...filter.statuses);
    }
    if (filter.platform !== undefined) {
      assertPlatform(filter.platform);
      clauses.push("platform = ?");
      args.push(filter.platform);
    }
    if (filter.accountId !== undefined) {
      clauses.push("account_id = ?");
      args.push(filter.accountId);
    }
    const rows = await queryRows({
      sql: `SELECT * FROM social_posts WHERE ${clauses.join(" AND ")}
        ORDER BY scheduled_at_utc, created_at, id`,
      args,
    });
    return rows.map(toPost);
  }

  /**
   * Atomic compare-and-set on status: a single conditional UPDATE, so concurrent callers
   * claiming the same post cannot both succeed. Transition rules live in the queue service.
   */
  async function transitionPost(
    id: string,
    fromStatuses: SocialPostStatus[],
    toStatus: SocialPostStatus,
    patch: SocialPostTransitionPatch = {},
  ): Promise<boolean> {
    assertStatus(toStatus);
    if (fromStatuses.length === 0) throw new Error("transitionPost requires at least one status to transition from");
    fromStatuses.forEach(assertStatus);

    const sets = ["status = ?", "updated_at = ?"];
    const args: SqlValue[] = [toStatus, timestamp()];
    const set = (column: string, value: SqlValue) => {
      sets.push(`${column} = ?`);
      args.push(value);
    };
    if (patch.externalPostId !== undefined) set("external_post_id", patch.externalPostId);
    if (patch.publishedAt !== undefined) set("published_at", patch.publishedAt);
    if (patch.scheduledAtUtc !== undefined) set("scheduled_at_utc", patch.scheduledAtUtc);
    if (patch.timezone !== undefined) set("timezone", patch.timezone);
    if (patch.confirmedSha256 !== undefined) set("confirmed_sha256", patch.confirmedSha256);
    if (patch.error !== undefined) {
      set("error_code", patch.error?.code ?? null);
      set("error_message", patch.error?.message ?? null);
    }
    args.push(id, ...fromStatuses);

    const result = await client.execute({
      sql: `UPDATE social_posts SET ${sets.join(", ")}
        WHERE id = ? AND status IN (${fromStatuses.map(() => "?").join(", ")})`,
      args,
    });
    return result.rowsAffected === 1;
  }

  return {
    upsertAccount,
    getAccount,
    getAccountTokens,
    updateAccountTokens,
    deleteAccount,
    listAccounts,
    insertPost,
    getPost,
    listPosts,
    transitionPost,
  };
}

export type SocialStorage = ReturnType<typeof createSocialStorage>;
