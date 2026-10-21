import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

// Same naming and extension rules as the staging upload flow (src/lib/video-upload).
const STAGING_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const SUPPORTED_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);

export class StagedVideoError extends Error {
  readonly code = "STAGED_VIDEO_INVALID" as const;
  constructor(message = "Invalid staged video") {
    super(message);
    this.name = "StagedVideoError";
  }
}

export type StagedVideo = { path: string; size: number; sha256: string };

export function isValidStagingFileName(stagingFile: string): boolean {
  return (
    STAGING_FILE_PATTERN.test(stagingFile) &&
    stagingFile !== "." &&
    stagingFile !== ".." &&
    SUPPORTED_EXTENSIONS.has(stagingFile.split(".").pop()?.toLowerCase() ?? "")
  );
}

/**
 * Resolves a staged video by name and hashes the exact bytes read through a no-follow descriptor
 * whose inode matches the checked path, so the hash cannot describe a different file.
 */
export async function resolveStagedVideo(args: { stagingRoot: string; stagingFile: string }): Promise<StagedVideo> {
  if (!isValidStagingFileName(args.stagingFile)) throw new StagedVideoError();
  const root = resolve(args.stagingRoot);
  const path = join(root, args.stagingFile);
  try {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new StagedVideoError();
    const rootReal = await realpath(root);
    const fileInfo = await lstat(path);
    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) throw new StagedVideoError();
    const fileReal = await realpath(path);
    if (!fileReal.startsWith(rootReal + sep)) throw new StagedVideoError();

    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let streamOwned = false;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size <= 0 || info.ino !== fileInfo.ino || info.dev !== fileInfo.dev) {
        throw new StagedVideoError();
      }
      const hash = createHash("sha256");
      // The stream owns the descriptor from here on and closes it on success or failure.
      const source = handle.createReadStream({ autoClose: true });
      streamOwned = true;
      for await (const chunk of source) hash.update(chunk as Buffer);
      return { path, size: info.size, sha256: hash.digest("hex") };
    } finally {
      if (!streamOwned) await handle.close();
    }
  } catch {
    throw new StagedVideoError();
  }
}
