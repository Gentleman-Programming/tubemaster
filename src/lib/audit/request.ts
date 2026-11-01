import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { auditEventRepository } from "@/lib/db";
import { createDefaultLogger, emitAuditEvent } from "@/lib/video-metadata/adapters/logger";

const logger = createDefaultLogger({ sink: auditEventRepository });

type Session = { user?: { id?: string | null } | null } | null;
type RouteHandler = (...args: never[]) => Promise<Response>;

export function withAuditRoute<T extends RouteHandler>(operation: string, handler: T): T {
  return (async (...args: Parameters<T>) => {
    const session = await getServerSession(authOptions) as Session;
    const userId = session?.user?.id ?? null;
    const operationId = randomUUID();
    emitAuditEvent(logger, "request.start", { operationId, operation }, userId);
    try {
      const response = await handler(...args);
      emitAuditEvent(logger, "request.success", { operationId, operation }, userId);
      return response;
    } catch (error) {
      emitAuditEvent(logger, "request.failure", { operationId, operation, code: "internal_error" }, userId);
      throw error;
    }
  }) as T;
}
