import { randomUUID } from "node:crypto";
import { DomainError, type ResolvedCredentials } from "../video-metadata/contracts";
import { YOUTUBE_WRITE_SCOPE } from "../auth";
import { mapProviderError } from "../provider-errors";
import type { QuotaAccountant } from "../quota/accountant";
import type { UploadFileSource, UploadProvider, UploadRequest, UploadResult } from "./contracts";
import { uploadRequestSchema } from "./schemas";

export type VideoUploadDependencies = {
  authResolver: { resolve(args: { credentialRef: UploadRequest["credentialRef"]; requiredScopes: readonly string[] }): Promise<ResolvedCredentials> };
  writeContext: { assertWriteChannel(args: { credentialRef: UploadRequest["credentialRef"]; credentials: ResolvedCredentials; expectedChannelId: string }): Promise<{ expectedChannelId: string }> };
  files: UploadFileSource;
  provider: UploadProvider;
  quotaAccountantFactory?: (credentials: ResolvedCredentials) => QuotaAccountant;
  operationIdFactory?: () => string;
};

export function createVideoUploadService(deps: VideoUploadDependencies) {
  return async function upload(input: unknown): Promise<UploadResult> {
    const parsed = uploadRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError({ code: "validation_failed", message: "Invalid private upload request" });
    }
    const request = parsed.data;
    let file;
    try {
      file = await deps.files.inspect(request.filePath);
      if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("Empty or invalid file");
    } catch {
      throw new DomainError({ code: "validation_failed", message: "Video file must exist, be readable, and be non-empty" });
    }
    const credentials = await deps.authResolver.resolve({ credentialRef: request.credentialRef, requiredScopes: [YOUTUBE_WRITE_SCOPE] });
    const channel = await deps.writeContext.assertWriteChannel({ credentialRef: request.credentialRef, credentials, expectedChannelId: request.expectedChannelId });
    const operationId = deps.operationIdFactory?.() ?? randomUUID();
    if (request.dryRun) return { status: "validated", operationId, channelId: channel.expectedChannelId, dryRun: true };
    if (request.confirmed !== true) {
      throw new DomainError({ code: "validation_failed", message: "Explicit confirmation is required for upload" });
    }
    // Accounting must be bound to the resolved identity before any provider write.
    let quotaAccountant: QuotaAccountant;
    try {
      const candidate = deps.quotaAccountantFactory?.(credentials);
      if (!candidate || typeof candidate.record !== "function") throw new Error("Quota accountant unavailable");
      quotaAccountant = candidate;
    } catch {
      throw new DomainError({ code: "validation_failed", message: "Upload quota accounting is unavailable" });
    }
    // A failed insert may have reached YouTube: surface the operation ID for reconciliation, never retry automatically.
    try {
      const videoId = await deps.provider.insert({
        credentials, file, title: request.title, description: request.description ?? "",
        tags: request.tags, categoryId: request.categoryId, defaultLanguage: request.defaultLanguage,
        defaultAudioLanguage: request.defaultAudioLanguage, license: request.license,
        selfDeclaredMadeForKids: request.selfDeclaredMadeForKids, containsSyntheticMedia: request.containsSyntheticMedia,
        operationId, channelId: channel.expectedChannelId, quotaAccountant,
      });
      if (!videoId) throw new Error("Upload response did not include a video ID");
      return { status: "uploaded", operationId, channelId: channel.expectedChannelId, videoId, visibility: "private", dryRun: false };
    } catch (error) {
      const mapped = mapProviderError(error, "update_failed");
      throw new DomainError({
        code: mapped.code,
        message: mapped.message,
        details: {
          ...(mapped.details && typeof mapped.details === "object" ? mapped.details : {}),
          operationId, outcome: "unknown", retryAutomatically: false,
        },
      });
    }
  };
}
