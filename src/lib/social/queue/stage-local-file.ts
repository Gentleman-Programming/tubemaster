import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

// Same extensions, naming and modes as the browser staging flow (src/lib/video-upload/staging.ts).
const SUPPORTED_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);
const CHUNK_BYTES = 1024 * 1024;

export class StageLocalFileError extends Error {
  readonly code = "INVALID_INPUT" as const;
  constructor(message: string) {
    super(message);
    this.name = "StageLocalFileError";
  }
}

export type StagedLocalFile = { stagingFile: string; size: number };

/**
 * Copies a local video into the staging root as `${randomUUID()}.${ext}` (0600, created with O_EXCL).
 * The source is only read, through a no-follow descriptor whose inode matches the checked path.
 */
export async function stageLocalFile(args: { path: string; stagingRoot: string; maxBytes: number }): Promise<StagedLocalFile> {
  if (!Number.isSafeInteger(args.maxBytes) || args.maxBytes <= 0) throw new StageLocalFileError("Invalid size limit");
  if (typeof args.path !== "string" || !isAbsolute(args.path)) throw new StageLocalFileError("The path must be absolute");
  const extension = /\.([a-z0-9]+)$/i.exec(basename(args.path))?.[1].toLowerCase();
  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    throw new StageLocalFileError("Unsupported video extension; use mp4, mov, webm or mkv");
  }

  const info = await lstat(args.path).catch(() => null);
  if (!info) throw new StageLocalFileError("The file does not exist");
  if (info.isSymbolicLink() || !info.isFile()) throw new StageLocalFileError("The path must be a regular file, not a symlink or directory");
  if (info.size <= 0) throw new StageLocalFileError("The file is empty");
  if (info.size > args.maxBytes) throw new StageLocalFileError(`The file exceeds the ${args.maxBytes}-byte limit`);

  const source = await open(args.path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!source) throw new StageLocalFileError("The file cannot be opened");
  let targetPath: string | undefined;
  let target: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const opened = await source.stat();
    if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) {
      throw new StageLocalFileError("The file changed while staging");
    }

    const root = resolve(args.stagingRoot);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new StageLocalFileError("Invalid staging root");

    const stagingFile = `${randomUUID()}.${extension}`;
    const path = join(root, stagingFile);
    target = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    targetPath = path;

    // Bytes are counted while copying so a file growing after the check still respects the limit.
    const buffer = Buffer.alloc(CHUNK_BYTES);
    let size = 0;
    while (true) {
      const { bytesRead } = await source.read(buffer, 0, CHUNK_BYTES, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > args.maxBytes) throw new StageLocalFileError(`The file exceeds the ${args.maxBytes}-byte limit`);
      await target.write(buffer, 0, bytesRead);
    }
    if (size === 0) throw new StageLocalFileError("The file is empty");
    await target.close();
    target = undefined;
    return { stagingFile, size };
  } catch (error) {
    await target?.close().catch(() => {});
    if (targetPath) await unlink(targetPath).catch(() => {});
    if (error instanceof StageLocalFileError) throw error;
    throw new StageLocalFileError("The file could not be staged");
  } finally {
    await source.close().catch(() => {});
  }
}
