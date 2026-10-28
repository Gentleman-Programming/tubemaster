import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";
import { DomainError } from "../video-metadata/contracts";
import type { UploadFileSource, UploadRequest, UploadResult } from "./contracts";
import { z } from "zod";
import { credentialRefSchema } from "../video-metadata/schemas";

const MAX_ITEMS = 10;
const CONFIRMATION_TTL_SECONDS = 600;
const VIDEO_INSERT_QUOTA_UNITS = 100;

const itemSchema = z.object({
  filePath: z.string().trim().min(1),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional().refine((tags) => !tags || tags.join(",").length <= 500, "Tags are too long"),
  categoryId: z.string().regex(/^\d+$/).optional(),
  defaultLanguage: z.string().trim().min(1).max(35).optional(),
  defaultAudioLanguage: z.string().trim().min(1).max(35).optional(),
  license: z.enum(["youtube", "creativeCommon"]).optional(),
  selfDeclaredMadeForKids: z.boolean().optional(),
  containsSyntheticMedia: z.boolean().optional(),
}).strict();

const requestSchema = z.object({
  credentialRef: credentialRefSchema,
  expectedChannelId: z.string().trim().min(1),
  items: z.array(itemSchema).min(1).max(MAX_ITEMS),
  dryRun: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  confirmationToken: z.string().optional(),
}).strict();

type MultiVideoUploadRequest = z.infer<typeof requestSchema>;
type PreparedItem = z.infer<typeof itemSchema> & {
  fileSize: number;
  fileSha256: string;
  operationId: string;
  channelId: string;
};

export type MultiVideoUploadPreviewItem = Omit<PreparedItem, "filePath"> & {
  visibility: "private";
  estimatedQuotaUnits: number;
};
export type MultiVideoUploadItemResult = {
  index: number;
  fileSha256: string;
  status: "uploaded" | "failed" | "unknown";
  operationId?: string;
  videoId?: string;
  error?: string;
  retryAutomatically?: boolean;
};
export type MultiVideoUploadResult =
  | {
      status: "validated";
      operationId: string;
      channelId: string;
      items: MultiVideoUploadPreviewItem[];
      estimatedQuotaUnits: number;
      confirmationToken: string;
      dryRun: true;
    }
  | {
      status: "completed";
      operationId: string;
      channelId: string;
      items: MultiVideoUploadItemResult[];
      dryRun: false;
    };

export type MultiVideoUploadDependencies = {
  upload: (input: UploadRequest) => Promise<UploadResult>;
  files: UploadFileSource;
  confirmationSecret: string;
  now?: () => number;
  operationIdFactory?: () => string;
  maxConcurrency?: number;
};

function invalid(message = "Invalid multi-video upload request"): DomainError {
  return new DomainError({ code: "validation_failed", message });
}

async function hashFile(file: { open(): Readable }): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of file.open()) hash.update(chunk);
  return hash.digest("hex");
}

function identity(request: MultiVideoUploadRequest, items: PreparedItem[]): string {
  return JSON.stringify([
    request.credentialRef,
    request.expectedChannelId,
    { reviewedDryRun: true },
    items.map(({ title, description, tags, categoryId, defaultLanguage, defaultAudioLanguage, license, selfDeclaredMadeForKids, containsSyntheticMedia, fileSize, fileSha256 }) => ({ title, description, tags, categoryId, defaultLanguage, defaultAudioLanguage, license, selfDeclaredMadeForKids, containsSyntheticMedia, fileSize, fileSha256 })),
  ]);
}

function createConfirmationToken(secret: string, expiry: number, binding: string): string {
  const signature = createHmac("sha256", secret).update(`${expiry}:${binding}`).digest("hex");
  return `${expiry}.${signature}`;
}

function isValidConfirmationToken(token: string | undefined, secret: string, binding: string, now: number): boolean {
  const [expiryText, signature] = token?.split(".") ?? [];
  const expiry = Number(expiryText);
  if (!Number.isSafeInteger(expiry) || expiry < Math.floor(now / 1000) || expiry > Math.floor(now / 1000) + CONFIRMATION_TTL_SECONDS ||
    !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createConfirmationToken(secret, expiry, binding).split(".")[1];
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}

export function createMultiVideoUploadService(deps: MultiVideoUploadDependencies) {
  const configuredConcurrency = deps.maxConcurrency ?? 2;
  const maxConcurrency = Number.isSafeInteger(configuredConcurrency) && configuredConcurrency > 0
    ? Math.min(MAX_ITEMS, configuredConcurrency)
    : 2;
  return async function upload(input: unknown): Promise<MultiVideoUploadResult> {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success || !deps.confirmationSecret) throw invalid();
    const request = parsed.data;
    const prepared: PreparedItem[] = [];
    for (const item of request.items) {
      let file: Awaited<ReturnType<UploadFileSource["inspect"]>>;
      try {
        file = await deps.files.inspect(item.filePath);
        if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("Invalid file");
      } catch {
        throw invalid("Every video file must exist, be readable, and be non-empty");
      }
      const preview = await deps.upload({
        credentialRef: request.credentialRef,
        expectedChannelId: request.expectedChannelId,
        filePath: item.filePath,
        title: item.title,
        description: item.description,
        tags: item.tags, categoryId: item.categoryId, defaultLanguage: item.defaultLanguage,
        defaultAudioLanguage: item.defaultAudioLanguage, license: item.license,
        selfDeclaredMadeForKids: item.selfDeclaredMadeForKids, containsSyntheticMedia: item.containsSyntheticMedia,
        visibility: "private",
        dryRun: true,
      });
      if (preview.status !== "validated") throw invalid();
      prepared.push({ ...item, fileSize: file.size, fileSha256: await hashFile(file), operationId: preview.operationId, channelId: preview.channelId });
    }

    const operationId = deps.operationIdFactory?.() ?? randomUUID();
    const binding = identity(request, prepared);
    const now = deps.now?.() ?? Date.now();
    const expiry = Math.floor(now / 1000) + CONFIRMATION_TTL_SECONDS;
    if (request.dryRun) return {
      status: "validated", operationId, channelId: prepared[0]?.channelId ?? request.expectedChannelId,
      items: prepared.map((item) => ({
        fileSize: item.fileSize, fileSha256: item.fileSha256, operationId: item.operationId,
        channelId: item.channelId, title: item.title, description: item.description, tags: item.tags,
        categoryId: item.categoryId, defaultLanguage: item.defaultLanguage, defaultAudioLanguage: item.defaultAudioLanguage,
        license: item.license, selfDeclaredMadeForKids: item.selfDeclaredMadeForKids, containsSyntheticMedia: item.containsSyntheticMedia,
        visibility: "private" as const,
        estimatedQuotaUnits: VIDEO_INSERT_QUOTA_UNITS,
      })),
      estimatedQuotaUnits: prepared.length * VIDEO_INSERT_QUOTA_UNITS,
      confirmationToken: createConfirmationToken(deps.confirmationSecret, expiry, binding), dryRun: true,
    };
    if (request.confirmed !== true || !isValidConfirmationToken(request.confirmationToken, deps.confirmationSecret, binding, now)) throw invalid("A valid multi-video confirmation is required");

    const results: MultiVideoUploadItemResult[] = new Array(prepared.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < prepared.length) {
        const index = nextIndex++;
        const item = prepared[index]!;
        try {
          const result = await deps.upload({
            credentialRef: request.credentialRef, expectedChannelId: request.expectedChannelId,
            filePath: item.filePath, title: item.title, description: item.description,
            tags: item.tags, categoryId: item.categoryId, defaultLanguage: item.defaultLanguage,
            defaultAudioLanguage: item.defaultAudioLanguage, license: item.license,
            selfDeclaredMadeForKids: item.selfDeclaredMadeForKids, containsSyntheticMedia: item.containsSyntheticMedia,
            visibility: "private", confirmed: true,
          });
          if (result.status !== "uploaded") throw invalid();
          results[index] = { index, fileSha256: item.fileSha256, status: "uploaded", operationId: result.operationId, videoId: result.videoId, retryAutomatically: false };
        } catch (error) {
          const domain = error instanceof DomainError ? error : invalid();
          const details = domain.details as Record<string, unknown> | undefined;
          const uncertain = details?.outcome === "unknown";
          results[index] = {
            index, fileSha256: item.fileSha256, status: uncertain ? "unknown" : "failed",
            operationId: typeof details?.operationId === "string" ? details.operationId : undefined,
            error: domain.code, retryAutomatically: uncertain ? false : undefined,
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(maxConcurrency, prepared.length) }, () => worker()));
    return { status: "completed", operationId, channelId: prepared[0]?.channelId ?? request.expectedChannelId, items: results, dryRun: false };
  };
}
