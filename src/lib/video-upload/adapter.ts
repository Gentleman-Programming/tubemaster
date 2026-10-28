import { constants } from "node:fs";
import { chmod, lstat, mkdtemp, open, realpath, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { DomainError } from "../video-metadata/contracts";
import type { UploadResult } from "./contracts";

const requestSchema = z.object({
  stagingFile: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/).refine((value) => value !== "." && value !== ".."),
  expectedChannelId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(100),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional().refine((tags) => !tags || tags.join(",").length <= 500, "Tags are too long"),
  categoryId: z.string().regex(/^\d+$/).optional(),
  defaultLanguage: z.string().trim().min(1).max(35).optional(),
  defaultAudioLanguage: z.string().trim().min(1).max(35).optional(),
  license: z.enum(["youtube", "creativeCommon"]).optional(),
  selfDeclaredMadeForKids: z.boolean().optional(),
  containsSyntheticMedia: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  confirmed: z.boolean().optional(),
}).strict();

const supportedExtensions = new Set(["mp4", "mov", "webm", "mkv"]);
const invalid = () => new DomainError({ code: "validation_failed", message: "Invalid staged video" });

export function createUploadAdapter(deps: {
  upload: (request: unknown) => Promise<UploadResult>;
  stagingRoot: string;
  maxBytes: number;
}) {
  return async (userId: string, input: unknown) => {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) throw new DomainError({ code: "validation_failed", message: "Invalid upload request" });
    const request = parsed.data;
    if (!supportedExtensions.has(request.stagingFile.split(".").pop()?.toLowerCase() ?? "")) throw invalid();
    if (!Number.isSafeInteger(deps.maxBytes) || deps.maxBytes <= 0) throw invalid();
    if (!request.dryRun && request.confirmed !== true) {
      throw new DomainError({ code: "validation_failed", message: "Explicit confirmation is required" });
    }
    const root = resolve(deps.stagingRoot);
    const path = join(root, request.stagingFile);
    let snapshotDir: string | undefined;
    let uploadPath = path;
    try {
      const rootInfo = await lstat(root);
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw invalid();
      const rootReal = await realpath(root);
      const fileInfo = await lstat(path);
      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw invalid();
      const fileReal = await realpath(path);
      if (!fileReal.startsWith(rootReal + sep)) throw invalid();
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      let sourceStreamOwned = false;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size <= 0 || info.size > deps.maxBytes || info.ino !== fileInfo.ino || info.dev !== fileInfo.dev) throw invalid();
        if (!request.dryRun) {
          snapshotDir = await mkdtemp(join(root, ".upload-snapshot-"));
          // mkdtemp uses 0700; explicitly enforce it even under an unusual umask.
          await chmod(snapshotDir, 0o700);
          uploadPath = join(snapshotDir, request.stagingFile);
          const snapshot = await open(uploadPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          // Streams own their descriptors. pipeline destroys both streams on failure and
          // waits for close; never close a stream-owned FileHandle a second time.
          const source = handle.createReadStream({ autoClose: true });
          sourceStreamOwned = true;
          const destination = snapshot.createWriteStream({ autoClose: true });
          await pipeline(source, destination);
          const copied = await stat(uploadPath);
          if (copied.size !== info.size || copied.size > deps.maxBytes) throw invalid();
        }
      } finally {
        if (!sourceStreamOwned) await handle.close();
      }
    } catch {
      if (snapshotDir) await rm(snapshotDir, { recursive: true, force: true });
      throw invalid();
    }
    try {
      return await deps.upload({
        credentialRef: { userId }, expectedChannelId: request.expectedChannelId,
        filePath: uploadPath, title: request.title, description: request.description,
        tags: request.tags, categoryId: request.categoryId, defaultLanguage: request.defaultLanguage,
        defaultAudioLanguage: request.defaultAudioLanguage, license: request.license,
        selfDeclaredMadeForKids: request.selfDeclaredMadeForKids, containsSyntheticMedia: request.containsSyntheticMedia,
        visibility: "private", dryRun: request.dryRun, confirmed: request.confirmed,
      });
    } finally {
      if (snapshotDir) await rm(snapshotDir, { recursive: true, force: true });
    }
  };
}
