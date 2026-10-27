import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainError } from "../video-metadata/contracts";
import { InMemoryQuotaAccountant } from "../quota/accountant";
import { createVideoRecoveryService } from "./services";
import type { RecoveryProvider } from "./contracts";

const base = { credentialRef: { userId: "owner" }, expectedChannelId: "channel-1", operationId: "upload-op", videoId: "video-1" };

function fixture(overrides: Partial<RecoveryProvider> = {}) {
  const writes: unknown[] = [];
  const provider: RecoveryProvider = {
    async reconcile() { return { status: "succeeded", videoId: "video-1", channelId: "channel-1", privacyStatus: "private" }; },
    async inspect() { return { videoId: "video-1", channelId: "channel-1", privacyStatus: "public" }; },
    async returnToPrivate(input) { writes.push(input); return { status: "cancelled", videoId: input.videoId, channelId: input.channelId, privacyStatus: "private" }; },
    ...overrides,
  };
  const service = createVideoRecoveryService({
    authResolver: { async resolve({ credentialRef }) { return { credentialRef, accessToken: "token", scopeSet: new Set<string>() }; } },
    writeContext: { async assertWriteChannel({ expectedChannelId }) { return { expectedChannelId }; } },
    provider,
    quotaAccountantFactory: () => new InMemoryQuotaAccountant(),
    confirmationSecret: "test-secret",
    now: () => 1_700_000_000_000,
    operationIdFactory: () => "recovery-op",
  });
  return { service, writes };
}

test("reconciles known success and preserves the target operation identity", async () => {
  const { service } = fixture();
  const result = await service.reconcile(base);
  assert.deepEqual(result, {
    status: "succeeded", operationId: "upload-op", videoId: "video-1", channelId: "channel-1", privacyStatus: "private",
  });
});

test("returns known absence and still-unknown outcomes without retrying", async () => {
  const absent = fixture({ async reconcile() { return { status: "absent", channelId: "channel-1" }; } });
  assert.deepEqual(await absent.service.reconcile({ ...base, videoId: undefined }), { status: "unsupported", operationId: "upload-op", reason: "provider_operation_identity_unavailable" });
  assert.deepEqual(await absent.service.reconcile(base), { status: "absent", operationId: "upload-op", channelId: "channel-1" });
  const unknown = fixture({ async reconcile() { return { status: "unknown", channelId: "channel-1", reason: "provider_state_ambiguous" }; } });
  assert.deepEqual(await unknown.service.reconcile(base), { status: "unknown", operationId: "upload-op", channelId: "channel-1", reason: "provider_state_ambiguous", retryAutomatically: false });
});

test("returns ordered multi-item reconciliation results without retrying mutations", async () => {
  let calls = 0;
  const { service } = fixture({ async reconcile({ videoId }) {
    calls++;
    return videoId === "video-1"
      ? { status: "succeeded", videoId, channelId: "channel-1", privacyStatus: "private" }
      : { status: "absent", channelId: "channel-1" };
  } });
  const result = await service.reconcileMany({ credentialRef: { userId: "owner" }, expectedChannelId: "channel-1", items: [
    { operationId: "first", videoId: "video-1" }, { operationId: "second", videoId: "video-2" },
  ] });
  assert.deepEqual(result.items.map((item) => [item.index, item.operationId, item.status]), [[0, "first", "succeeded"], [1, "second", "absent"]]);
  assert.equal(calls, 2);
});

test("requires confirmation immediately before returning a video to private", async () => {
  const { service, writes } = fixture();
  const preview = await service.cancel({ ...base, dryRun: true });
  assert.equal(preview.status, "validated");
  if (preview.status !== "validated") return;
  assert.equal(writes.length, 0);
  const result = await service.cancel({ ...base, dryRun: false, confirmed: true, confirmationToken: preview.confirmationToken });
  assert.deepEqual(result, { status: "cancelled", operationId: "upload-op", recoveryOperationId: "recovery-op", videoId: "video-1", channelId: "channel-1", privacyStatus: "private", dryRun: false });
  assert.equal(writes.length, 1);
});

test("fails closed for unsupported cancellation and uncertain provider errors", async () => {
  const unsupported = fixture({ async returnToPrivate() { return { status: "unsupported", reason: "provider_cannot_cancel" }; } });
  const preview = await unsupported.service.cancel({ ...base, dryRun: true });
  assert.equal(preview.status, "validated");
  if (preview.status !== "validated") return;
  assert.deepEqual(await unsupported.service.cancel({ ...base, confirmed: true, confirmationToken: preview.confirmationToken, dryRun: false }), {
    status: "unsupported", operationId: "upload-op", recoveryOperationId: "recovery-op", videoId: "video-1", channelId: "channel-1", reason: "provider_cannot_cancel", dryRun: false,
  });
  const uncertain = fixture({ async returnToPrivate() { throw new DomainError({ code: "update_failed", message: "provider failed" }); } });
  const uncertainPreview = await uncertain.service.cancel({ ...base, dryRun: true });
  assert.equal(uncertainPreview.status, "validated");
  if (uncertainPreview.status !== "validated") return;
  await assert.rejects(uncertain.service.cancel({ ...base, confirmed: true, confirmationToken: uncertainPreview.confirmationToken, dryRun: false }), (error: unknown) => {
    assert.ok(error instanceof DomainError);
    assert.deepEqual(error.details, { operationId: "upload-op", recoveryOperationId: "recovery-op", outcome: "unknown", retryAutomatically: false });
    return true;
  });
});

test("rejects changed channel or changed preview state without provider mutation", async () => {
  const mismatch = fixture({ async inspect() { return { videoId: "video-1", channelId: "other", privacyStatus: "public" }; } });
  await assert.rejects(mismatch.service.cancel({ ...base, dryRun: true }), { code: "WRITE_CHANNEL_MISMATCH" });
  let inspectCalls = 0;
  const changed = fixture({ async inspect() {
    inspectCalls++;
    return { videoId: "video-1", channelId: "channel-1", privacyStatus: inspectCalls === 1 ? "public" : "private" };
  } });
  const preview = await changed.service.cancel({ ...base, dryRun: true });
  assert.equal(preview.status, "validated");
  if (preview.status !== "validated") return;
  await assert.rejects(changed.service.cancel({ ...base, confirmed: true, confirmationToken: preview.confirmationToken, dryRun: false }), { code: "validation_failed" });
});
