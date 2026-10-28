import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { createVideoUploadService } from "./services";
import { DomainError } from "../video-metadata/contracts";
import { InMemoryQuotaAccountant } from "../quota/accountant";

function fixture() {
  let writes = 0;
  let received: unknown;
  const quota = new InMemoryQuotaAccountant();
  const upload = createVideoUploadService({
    authResolver: { async resolve({ credentialRef }) { return { credentialRef, accessToken: "token", scopeSet: new Set() }; } },
    writeContext: { async assertWriteChannel({ expectedChannelId }) {
      if (expectedChannelId !== "active") throw new DomainError({ code: "WRITE_CHANNEL_MISMATCH", message: "mismatch" });
      return { expectedChannelId };
    } },
    files: { async inspect(path) { if (path !== "video.mp4") throw new Error("missing"); return { size: 3, open: () => Readable.from(["abc"]) }; } },
    provider: { async insert(args) {
      received = args;
      const { quotaAccountant, operationId, channelId } = args;
      writes++;
      quotaAccountant?.record({ operationId, channelId, operation: "videos.insert" });
      return "video-id";
    } },
    quotaAccountantFactory: () => quota,
    operationIdFactory: () => "operation-1",
  });
  return { upload, quota, writes: () => writes, received: () => received };
}
const input = { credentialRef: { accessToken: "token" }, expectedChannelId: "active", filePath: "video.mp4", title: "Title", description: "Description", tags: ["one", "two"], categoryId: "22", defaultLanguage: "en", defaultAudioLanguage: "en", license: "youtube", selfDeclaredMadeForKids: false, containsSyntheticMedia: true, visibility: "private" as const };

test("invalid metadata, visibility, and file fail without a provider write", async () => {
  const f = fixture();
  for (const patch of [{ title: " " }, { visibility: "public" }, { filePath: "missing" }, { expectedChannelId: "" }]) {
    await assert.rejects(f.upload({ ...input, ...patch, confirmed: true }), { code: "validation_failed" });
  }
  assert.equal(f.writes(), 0);
});

test("mismatched channel, dryRun, and missing confirmation never write", async () => {
  const f = fixture();
  await assert.rejects(f.upload({ ...input, expectedChannelId: "other", confirmed: true }), { code: "WRITE_CHANNEL_MISMATCH" });
  assert.deepEqual(await f.upload({ ...input, dryRun: true }), { status: "validated", operationId: "operation-1", channelId: "active", dryRun: true });
  await assert.rejects(f.upload(input), { code: "validation_failed" });
  assert.equal(f.writes(), 0);
  assert.equal(f.quota.entries().length, 0);
});

test("confirmed upload records insert quota and returns reconciliation ID", async () => {
  const f = fixture();
  assert.deepEqual(await f.upload({ ...input, confirmed: true }), {
    status: "uploaded", operationId: "operation-1", channelId: "active", videoId: "video-id", visibility: "private", dryRun: false,
  });
  assert.equal(f.writes(), 1);
  assert.equal(f.quota.entries()[0]?.estimatedUnits, 100);
  const received = f.received() as {
    tags: string[];
    categoryId: string;
    defaultLanguage: string;
    defaultAudioLanguage: string;
    license: string;
    selfDeclaredMadeForKids: boolean;
    containsSyntheticMedia: boolean;
  };
  assert.deepEqual({
    tags: received.tags,
    categoryId: received.categoryId,
    defaultLanguage: received.defaultLanguage,
    defaultAudioLanguage: received.defaultAudioLanguage,
    license: received.license,
    selfDeclaredMadeForKids: received.selfDeclaredMadeForKids,
    containsSyntheticMedia: received.containsSyntheticMedia,
  }, {
    tags: ["one", "two"], categoryId: "22", defaultLanguage: "en", defaultAudioLanguage: "en", license: "youtube", selfDeclaredMadeForKids: false, containsSyntheticMedia: true,
  });
});

test("provider failure maps to stable error with uncertain outcome and no retry", async () => {
  let calls = 0;
  const f = fixture();
  // Replace the mocked provider via a separate service using the same test inputs.
  const upload = createVideoUploadService({
    authResolver: { async resolve({ credentialRef }) { return { credentialRef, accessToken: "token", scopeSet: new Set() }; } },
    writeContext: { async assertWriteChannel({ expectedChannelId }) { return { expectedChannelId }; } },
    files: { async inspect() { return { size: 1, open: () => Readable.from(["a"]) }; } },
    provider: { async insert() { calls++; throw { response: { status: 403, data: { error: { errors: [{ reason: "forbidden" }] } } } }; } },
    quotaAccountantFactory: () => new InMemoryQuotaAccountant(),
    operationIdFactory: () => "operation-1",
  });
  await assert.rejects(upload({ ...input, confirmed: true }), (error: unknown) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, "unauthorized");
    assert.deepEqual(error.details, { operationId: "operation-1", outcome: "unknown", retryAutomatically: false, diagnostic: { httpStatus: 403, apiReason: "forbidden", retriable: false } });
    return true;
  });
  assert.equal(calls, 1);
  assert.equal(f.writes(), 0);
});
