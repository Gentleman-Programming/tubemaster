import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { test } from "node:test";
import { DomainError } from "../video-metadata/contracts";
import type { UploadRequest, UploadResult } from "./contracts";
import { createMultiVideoUploadService } from "./multi-video";

const base = {
  credentialRef: { userId: "owner" },
  expectedChannelId: "channel-1",
  items: [
    { filePath: "one.mp4", title: "One", tags: ["one"], categoryId: "22", defaultLanguage: "en", defaultAudioLanguage: "en", license: "youtube", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
    { filePath: "two.mp4", title: "Two", description: "Second", tags: ["two"] },
  ],
};

function fixture(options: { failDryRun?: string; failUpload?: string } = {}) {
  let writes = 0;
  const files = new Map([
    ["one.mp4", "one-bytes"],
    ["two.mp4", "two-bytes"],
  ]);
  const upload = async (input: UploadRequest): Promise<UploadResult> => {
    if (input.dryRun) {
      if (input.filePath === options.failDryRun) throw new DomainError({ code: "validation_failed", message: "invalid item" });
      return { status: "validated", operationId: `preview-${input.filePath}`, channelId: "channel-1", dryRun: true };
    }
    writes++;
    if (input.filePath === options.failUpload) {
      throw new DomainError({ code: "update_failed", message: "provider failed", details: { operationId: `upload-${input.filePath}`, outcome: "unknown", retryAutomatically: false } });
    }
    return { status: "uploaded", operationId: `upload-${input.filePath}`, channelId: "channel-1", videoId: `video-${input.filePath}`, visibility: "private", dryRun: false };
  };
  const service = createMultiVideoUploadService({
    upload,
    files: {
      async inspect(path) {
        const value = files.get(path);
        if (!value) throw new Error("missing");
        return { size: Buffer.byteLength(value), open: () => Readable.from([value]) };
      },
    },
    confirmationSecret: "test-secret",
    now: () => 1_700_000_000_000,
    operationIdFactory: () => "batch-operation",
  });
  return { service, writes: () => writes, files };
}

async function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("previews every item deterministically and returns a signed confirmation binding", async () => {
  const f = fixture();
  const result = await f.service({ ...base, dryRun: true });
  assert.equal(result.status, "validated");
  if (result.status !== "validated") return;
  assert.equal(result.channelId, "channel-1");
  assert.equal(result.items.length, 2);
  assert.equal(result.estimatedQuotaUnits, 200);
  assert.deepEqual(result.items.map((item) => item.estimatedQuotaUnits), [100, 100]);
  assert.deepEqual(result.items.map((item) => item.title), ["One", "Two"]);
  assert.deepEqual(result.items.map((item) => item.tags), [["one"], ["two"]]);
  assert.equal("filePath" in result.items[0]!, false);
  assert.deepEqual(result.items.map((item) => item.fileSha256), [await digest("one-bytes"), await digest("two-bytes")]);
  assert.match(result.confirmationToken, /^1700000600\.[a-f0-9]{64}$/);
  assert.equal(f.writes(), 0);
});

test("rejects the whole collection before any provider write when one item fails preflight", async () => {
  const f = fixture({ failDryRun: "two.mp4" });
  await assert.rejects(f.service({ ...base, confirmed: true }), { code: "validation_failed" });
  assert.equal(f.writes(), 0);
});

test("requires a matching, unexpired confirmation and returns ordered per-item outcomes", async () => {
  const f = fixture();
  const preview = await f.service({ ...base, dryRun: true });
  assert.equal(preview.status, "validated");
  if (preview.status !== "validated") return;
  const result = await f.service({ ...base, confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.items.map((item) => item.videoId), ["video-one.mp4", "video-two.mp4"]);
  assert.deepEqual(result.items.map((item) => item.status), ["uploaded", "uploaded"]);
  assert.equal(f.writes(), 2);
});

test("preserves uncertain per-item outcomes without retrying", async () => {
  const f = fixture({ failUpload: "two.mp4" });
  const preview = await f.service({ ...base, dryRun: true });
  assert.equal(preview.status, "validated");
  if (preview.status !== "validated") return;
  const result = await f.service({ ...base, confirmed: true, confirmationToken: preview.confirmationToken });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.deepEqual(result.items.map((item) => item.status), ["uploaded", "unknown"]);
  assert.equal(result.items[1]?.retryAutomatically, false);
  assert.equal(f.writes(), 2);
});
