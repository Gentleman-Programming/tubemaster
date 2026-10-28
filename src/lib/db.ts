import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import path from "path";
import { eq } from "drizzle-orm";
import { initializeSocialTables } from "./social/storage";

const rawClient = createClient({
  url: `file:${path.join(process.cwd(), "data", "playlist-manager.db")}`,
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull(),
  image: text("image"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiry: integer("token_expiry"),
  oauthScope: text("oauth_scope"),
  selectedChannelId: text("selected_channel_id"),
});

export const rules = sqliteTable("rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  matchField: text("match_field").notNull(),
  matchType: text("match_type").notNull(),
  matchValue: text("match_value").notNull(),
  playlistId: text("playlist_id").notNull(),
  playlistTitle: text("playlist_title").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const transcriptIndexEntries = sqliteTable("transcript_index_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  videoId: text("video_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  identity: text("identity").notNull(),
  order: integer("entry_order").notNull(),
});

export const transcriptEmbeddingEntries = sqliteTable("transcript_embedding_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  videoId: text("video_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  identity: text("identity").notNull(),
  vector: text("vector").notNull(),
  dimension: integer("dimension").notNull(),
  order: integer("entry_order").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
});

async function initializeDatabase() {
  await rawClient.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL,
      image TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry INTEGER,
      oauth_scope TEXT,
      selected_channel_id TEXT
    );
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      match_field TEXT NOT NULL,
      match_type TEXT NOT NULL,
      match_value TEXT NOT NULL,
      playlist_id TEXT NOT NULL,
      playlist_title TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS quota_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_kind TEXT NOT NULL,
      user_id TEXT,
      operation_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      estimated_units INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      bucket_start TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transcript_index_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      identity TEXT NOT NULL,
      entry_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transcript_embedding_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      identity TEXT NOT NULL,
      vector TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      entry_order INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL
    );
  `);

  // Migration: add selected_channel_id if missing (idempotent)
  try {
    await rawClient.execute("ALTER TABLE users ADD COLUMN selected_channel_id TEXT");
  } catch {
    // Column already exists
  }

  // Migration: add oauth_scope if missing (idempotent)
  try {
    await rawClient.execute("ALTER TABLE users ADD COLUMN oauth_scope TEXT");
  } catch {
    // Column already exists
  }

  await initializeSocialTables(rawClient);
}

export const databaseInitialization = initializeDatabase().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  throw new Error(`Database initialization failed: ${message}`);
});

const client = new Proxy(rawClient, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);

    if (typeof value !== "function") {
      return value;
    }

    if (
      property === "execute" ||
      property === "batch" ||
      property === "transaction" ||
      property === "executeMultiple"
    ) {
      return async (...args: unknown[]) => {
        await databaseInitialization;
        return Reflect.apply(value, target, args);
      };
    }

    return value.bind(target);
  },
});

export const quotaClient = client;

export const db = drizzle(client, { schema: { users, rules, transcriptIndexEntries, transcriptEmbeddingEntries } });

export type StoredOAuthToken = {
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number | null;
  scope: string | null;
};

export async function getUserOAuthTokens(
  userId: string
): Promise<StoredOAuthToken | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) return null;

  return {
    userId: row.id,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    tokenExpiry: row.tokenExpiry,
    scope: row.oauthScope,
  };
}

export async function saveUserOAuthTokens(
  userId: string,
  patch: Partial<Omit<StoredOAuthToken, "userId">>
) {
  await db
    .update(users)
    .set({
      accessToken: patch.accessToken,
      refreshToken: patch.refreshToken,
      tokenExpiry: patch.tokenExpiry,
      oauthScope: patch.scope,
    })
    .where(eq(users.id, userId));
}

type UpsertUserOAuthOnSignInInput = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number | null;
  scope: string | null;
};

export async function upsertUserOAuthOnSignIn(
  input: UpsertUserOAuthOnSignInInput
) {
  const existing = await getUserOAuthTokens(input.userId);

  if (existing) {
    await db
      .update(users)
      .set({
        name: input.name,
        email: input.email,
        image: input.image,
        accessToken: input.accessToken ?? existing.accessToken,
        refreshToken: input.refreshToken ?? existing.refreshToken,
        tokenExpiry: input.tokenExpiry,
        oauthScope: input.scope ?? existing.scope,
      })
      .where(eq(users.id, input.userId));
    return;
  }

  await db.insert(users).values({
    id: input.userId,
    name: input.name,
    email: input.email,
    image: input.image,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenExpiry: input.tokenExpiry,
    oauthScope: input.scope,
  });
}

export type UpsertOAuthUserFromCliInput = {
  userId: string;
  email: string;
  name: string | null;
  image: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: number | null;
  scope: string | null;
};

export type OAuthUserSummary = {
  userId: string;
  email: string;
  name: string | null;
  tokenExpiry: number | null;
  hasRefreshToken: boolean;
};

export async function upsertOAuthUserFromCli(input: UpsertOAuthUserFromCliInput) {
  const [existing] = await db.select().from(users).where(eq(users.id, input.userId));

  if (existing) {
    await db
      .update(users)
      .set({
        email: input.email,
        name: input.name,
        image: input.image,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken ?? existing.refreshToken,
        tokenExpiry: input.tokenExpiry,
        oauthScope: input.scope ?? existing.oauthScope,
      })
      .where(eq(users.id, input.userId));

    return;
  }

  await db.insert(users).values({
    id: input.userId,
    email: input.email,
    name: input.name,
    image: input.image,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenExpiry: input.tokenExpiry,
    oauthScope: input.scope,
  });
}

export async function listOAuthUsers(): Promise<OAuthUserSummary[]> {
  const rows = await db.select().from(users);

  return rows
    .map((row) => ({
      userId: row.id,
      email: row.email,
      name: row.name,
      tokenExpiry: row.tokenExpiry,
      hasRefreshToken: !!row.refreshToken,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

export async function getOAuthUserSummary(
  userId: string
): Promise<OAuthUserSummary | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) return null;

  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    tokenExpiry: row.tokenExpiry,
    hasRefreshToken: !!row.refreshToken,
  };
}

export async function clearUserOAuthTokens(userId: string) {
  await db
    .update(users)
    .set({
      accessToken: null,
      refreshToken: null,
      tokenExpiry: null,
      oauthScope: null,
    })
    .where(eq(users.id, userId));
}

export async function getSelectedChannelId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ selectedChannelId: users.selectedChannelId })
    .from(users)
    .where(eq(users.id, userId));

  return row?.selectedChannelId ?? null;
}

export async function setSelectedChannelId(userId: string, channelId: string): Promise<void> {
  await db
    .update(users)
    .set({ selectedChannelId: channelId })
    .where(eq(users.id, userId));
}
