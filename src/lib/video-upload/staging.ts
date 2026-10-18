import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

export class StageError extends Error {}
const extensions = new Set(["mp4", "mov", "webm", "mkv"]);

export async function stageVideo(request: Request, rootPath: string, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new StageError("validation_failed");
  const contentType = request.headers.get("content-type") ?? "";
  const boundary = /^multipart\/form-data;\s*boundary=(?:"([A-Za-z0-9'()+_,.\/:=?-]{1,70})"|([A-Za-z0-9'()+_,.\/:=?-]{1,70}))\s*$/i.exec(contentType)?.slice(1).find(Boolean);
  if (!boundary || !request.body) throw new StageError("validation_failed");
  const iterator = request.body.getReader();
  const encoder = new TextEncoder();
  const marker = encoder.encode(`\r\n--${boundary}--`);
  const start = encoder.encode(`--${boundary}\r\n`);
  let buffer = new Uint8Array(0);
  let total = 0;
  const pull = async () => {
    const part = await iterator.read();
    if (part.done) throw new StageError("validation_failed");
    // Bound transient memory even if an unusual runtime supplies a huge stream chunk.
    if (part.value.byteLength > 8 * 1024 * 1024) throw new StageError("validation_failed");
    total += part.value.byteLength;
    if (total > maxBytes + 8192) throw new StageError("validation_failed");
    const next = new Uint8Array(buffer.length + part.value.length);
    next.set(buffer); next.set(part.value, buffer.length); buffer = next;
  };
  const indexOf = (needle: Uint8Array) => {
    outer: for (let i = 0; i <= buffer.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (buffer[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  };
  let path: string | undefined;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    while (buffer.length < start.length) await pull();
    if (indexOf(start) !== 0) throw new StageError("validation_failed");
    buffer = buffer.slice(start.length);
    const headerEnd = encoder.encode("\r\n\r\n");
    while (indexOf(headerEnd) < 0) {
      if (buffer.length > 4096) throw new StageError("validation_failed");
      await pull();
    }
    const end = indexOf(headerEnd);
    if (end > 4096) throw new StageError("validation_failed");
    const headers = new TextDecoder("utf-8", { fatal: true }).decode(buffer.slice(0, end));
    buffer = buffer.slice(end + 4);
    const disposition = /^content-disposition: form-data; name="file"; filename="([^"\r\n]+)"$/im.exec(headers);
    if (!disposition || headers.split("\r\n").filter((line) => /^content-disposition:/i.test(line)).length !== 1) throw new StageError("validation_failed");
    const filename = disposition[1];
    const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1].toLowerCase();
    if (!extension || !extensions.has(extension)) throw new StageError("validation_failed");
    const root = resolve(rootPath);
    await mkdir(root, { recursive: true, mode: 0o700 });
    if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new StageError("validation_failed");
    const stagingFile = `${randomUUID()}.${extension}`;
    const target = join(root, stagingFile);
    handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    path = target;
    let size = 0;
    while (true) {
      const at = indexOf(marker);
      const count = at >= 0 ? at : Math.max(0, buffer.length - marker.length + 1);
      if (count) {
        size += count;
        if (size > maxBytes) throw new StageError("validation_failed");
        await handle.writeFile(buffer.slice(0, count));
        buffer = buffer.slice(count);
      }
      if (at >= 0) break;
      await pull();
    }
    if (!size) throw new StageError("validation_failed");
    buffer = buffer.slice(marker.length);
    while (buffer.length < 2) {
      const trailing = await iterator.read();
      if (trailing.done) break;
      const next = new Uint8Array(buffer.length + trailing.value.length);
      next.set(buffer); next.set(trailing.value, buffer.length); buffer = next;
      if (buffer.length > 2) throw new StageError("validation_failed");
    }
    if (buffer.length === 2 && (buffer[0] !== 13 || buffer[1] !== 10)) throw new StageError("validation_failed");
    if (buffer.length !== 0 && buffer.length !== 2) throw new StageError("validation_failed");
    const remaining = await iterator.read();
    if (!remaining.done) throw new StageError("validation_failed");
    await handle.close(); handle = undefined;
    return { stagingFile, filename, size };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (path) await unlink(path).catch(() => {});
    throw error;
  } finally {
    iterator.releaseLock();
  }
}
