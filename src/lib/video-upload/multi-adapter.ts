import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, realpath, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { DomainError } from "../video-metadata/contracts";
import type { MultiVideoUploadResult } from "./multi-video";

const itemSchema = z.object({
  stagingFile: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/).refine((value) => value !== "." && value !== ".."),
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
  expectedChannelId: z.string().trim().min(1),
  items: z.array(itemSchema).min(1).max(10),
  dryRun: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  confirmationToken: z.string().optional(),
}).strict();
const supportedExtensions = new Set(["mp4", "mov", "webm", "mkv"]);
const invalid = (message = "Invalid staged video collection") => new DomainError({ code: "validation_failed", message });

type ValidatedFile = { stagingFile: string; path: string; size: number; dev: number; ino: number };

async function validateFile(root: string, rootReal: string, stagingFile: string, maxBytes: number): Promise<ValidatedFile> {
  if (!supportedExtensions.has(stagingFile.split(".").pop()?.toLowerCase() ?? "")) throw invalid("Unsupported video format");
  const path = join(root, stagingFile);
  const fileInfo = await lstat(path);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw invalid();
  const fileReal = await realpath(path);
  if (!fileReal.startsWith(rootReal + sep)) throw invalid();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > maxBytes || info.ino !== fileInfo.ino || info.dev !== fileInfo.dev) throw invalid();
    return { stagingFile, path, size: info.size, dev: info.dev, ino: info.ino };
  } finally {
    await handle.close();
  }
}

export function createMultiUploadAdapter(deps: {
  upload: (userId: string, input: unknown) => Promise<MultiVideoUploadResult>;
  stagingRoot: string;
  maxBytes: number;
}) {
  return async (userId: string, input: unknown) => {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success || !userId.trim() || !Number.isSafeInteger(deps.maxBytes) || deps.maxBytes <= 0) throw invalid();
    const request = parsed.data;
    if (!request.dryRun && request.confirmed !== true) throw new DomainError({ code: "validation_failed", message: "Explicit confirmation is required" });
    const root = resolve(deps.stagingRoot);
    let rootReal: string;
    try {
      const rootInfo = await lstat(root);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw invalid();
      rootReal = await realpath(root);
    } catch {
      throw invalid();
    }
    let files: ValidatedFile[];
    try {
      files = [];
      for (const item of request.items) files.push(await validateFile(root, rootReal, item.stagingFile, deps.maxBytes));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw invalid();
    }

    let snapshotDir: string | undefined;
    try {
      const uploadFiles = files.map((file) => file.path);
      if (!request.dryRun) {
        snapshotDir = await mkdtemp(join(root, ".multi-upload-snapshot-"));
        await chmod(snapshotDir, 0o700);
        for (const file of files) {
          const source = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
          const sourceInfo = await source.stat();
          if (!sourceInfo.isFile() || sourceInfo.size !== file.size || sourceInfo.ino !== file.ino || sourceInfo.dev !== file.dev) {
            await source.close();
            throw invalid("A staged video changed before confirmation");
          }
          const destination = await open(join(snapshotDir, file.stagingFile), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try {
            await pipeline(source.createReadStream({ autoClose: true }), destination.createWriteStream({ autoClose: true }));
            const copied = await stat(join(snapshotDir, file.stagingFile));
            if (copied.size !== file.size) throw invalid();
          } finally {
            await source.close().catch(() => undefined);
            await destination.close().catch(() => undefined);
          }
        }
        for (let index = 0; index < uploadFiles.length; index++) uploadFiles[index] = join(snapshotDir, files[index]!.stagingFile);
      }
      return await deps.upload(userId, {
        credentialRef: { userId }, expectedChannelId: request.expectedChannelId,
        items: request.items.map((item, index) => ({ filePath: uploadFiles[index]!, title: item.title, description: item.description, tags: item.tags, categoryId: item.categoryId, defaultLanguage: item.defaultLanguage, defaultAudioLanguage: item.defaultAudioLanguage, license: item.license, selfDeclaredMadeForKids: item.selfDeclaredMadeForKids, containsSyntheticMedia: item.containsSyntheticMedia })),
        dryRun: request.dryRun, confirmed: request.confirmed, confirmationToken: request.confirmationToken,
      });
    } finally {
      if (snapshotDir) await rm(snapshotDir, { recursive: true, force: true });
    }
  };
}
