type LogLevel = "info" | "error";

export type DurableAuditEvent = {
  userId: string | null;
  operationId: string;
  event: string;
  timestamp: Date;
  context: Record<string, string | number | boolean>;
};

export type DurableAuditSink = {
  append: (event: DurableAuditEvent) => Promise<void>;
};

export function getCredentialUserId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("userId" in value)) return undefined;
  const userId = (value as { userId?: unknown }).userId;
  return typeof userId === "string" ? userId : undefined;
}

const operations = [
  "video_metadata.list", "video_metadata.preview", "video_metadata.apply",
  "transcript.get", "playlist.list", "playlist.create", "playlist.update", "request",
  "playlist.delete", "playlist.add_videos", "playlist.remove_videos",
] as const;
const phases = ["start", "dry_run", "success", "failure"] as const;
const allowedEvents = new Set<string>(operations.flatMap((operation) => phases.map((phase) => `${operation}.${phase}`)));
const allowedContext = new Set(["operationId", "operation", "channelId", "videoId", "playlistId", "dryRun", "count", "code", "transcriptStatus"]);

/** Only this entry point should be used for operational audit events. Never forward raw inputs or errors. */
export function emitAuditEvent(
  logger: VideoMetadataLogger | undefined,
  event: string,
  context: Record<string, unknown> = {},
  userId?: string | null,
): void {
  if (!logger || !allowedEvents.has(event)) return;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!allowedContext.has(key)) continue;
    if (typeof value === "string" && value.length <= 128) safe[key] = value;
    else if (typeof value === "boolean" && key === "dryRun") safe[key] = value;
    else if (typeof value === "number" && key === "count" && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
  }
  try {
    logger[event.endsWith(".failure") ? "error" : "info"]({
      event,
      context: safe,
      ...(userId === undefined ? {} : { userId }),
    });
  } catch {
    // Audit transport is observational and cannot alter workflow results.
  }
}


type LogPayload = {
  event: string;
  context?: Record<string, unknown>;
  userId?: string | null;
};

export type VideoMetadataLogger = {
  info: (payload: LogPayload) => void;
  error: (payload: LogPayload) => void;
};

function log(level: LogLevel, payload: LogPayload, options: { userId: string | null; sink?: DurableAuditSink }) {
  const timestamp = new Date();
  const line = {
    level,
    event: payload.event,
    timestamp: timestamp.toISOString(),
    ...(payload.context ? { context: payload.context } : {}),
  };

  process.stderr.write(`${JSON.stringify(line)}\n`);

  const operationId = payload.context?.operationId;
  if (options.sink && typeof operationId === "string") {
    void options.sink.append({
      userId: payload.userId ?? options.userId,
      operationId,
      event: payload.event,
      timestamp,
      context: (payload.context ?? {}) as Record<string, string | number | boolean>,
    }).catch(() => {
      // Durable audit persistence is observational and cannot alter workflow results.
    });
  }
}

export function createDefaultLogger(options: { userId?: string | null; sink?: DurableAuditSink } = {}): VideoMetadataLogger {
  const resolved = { userId: options.userId ?? null, sink: options.sink };
  return {
    info(payload) {
      log("info", payload, resolved);
    },
    error(payload) {
      log("error", payload, resolved);
    },
  };
}
