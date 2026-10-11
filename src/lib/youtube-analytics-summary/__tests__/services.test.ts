import assert from "node:assert/strict";
import test from "node:test";
import { YOUTUBE_ANALYTICS_READ_SCOPE } from "../../auth";
import { DomainError, type ResolvedCredentials } from "../../video-metadata/contracts";
import { createYoutubeAnalyticsSummaryService } from "../services";

const credentialRef = { userId: "user-1" };
const credentials: ResolvedCredentials = {
  credentialRef,
  accessToken: "fake-token",
  scopeSet: new Set([YOUTUBE_ANALYTICS_READ_SCOPE]),
};
const args = { credentialRef, startDate: "2026-01-01", endDate: "2026-01-31" };
const days = [{ date: "2026-01-01", views: 7, likes: 2, comments: 1, estimatedMinutesWatched: 12 }];

test("accepts inclusive one- and 31-day calendar ranges and requests analytics scope", async () => {
  const requested: unknown[] = [];
  const queries: unknown[] = [];
  const service = createYoutubeAnalyticsSummaryService({
    now: () => new Date("2026-02-01T12:00:00Z"),
    authResolver: { resolve: async (request) => { requested.push(request); return credentials; } },
    youtubeAnalyticsApi: { query: async (query) => { queries.push(query); return days; } },
  });
  for (const endDate of ["2026-01-01", "2026-01-31"]) {
    assert.deepEqual(await service({ ...args, endDate }), {
      kind: "analytics-summary", startDate: args.startDate, endDate, days,
    });
  }
  assert.deepEqual(requested, [
    { credentialRef, requiredScopes: [YOUTUBE_ANALYTICS_READ_SCOPE] },
    { credentialRef, requiredScopes: [YOUTUBE_ANALYTICS_READ_SCOPE] },
  ]);
  assert.deepEqual(queries, [
    { credentials, startDate: args.startDate, endDate: "2026-01-01" },
    { credentials, startDate: args.startDate, endDate: "2026-01-31" },
  ]);
});

test("rejects malformed, impossible, future, reversed, and overlong dates without dependencies", async () => {
  let authCalls = 0;
  let providerCalls = 0;
  let quotaCalls = 0;
  const service = createYoutubeAnalyticsSummaryService({
    now: () => new Date("2026-02-01T12:00:00Z"),
    authResolver: { resolve: async () => { authCalls++; return credentials; } },
    youtubeAnalyticsApi: { query: async () => { providerCalls++; return days; } },
    quotaAccountant: { record: () => { quotaCalls++; } },
  });
  for (const [startDate, endDate] of [
    ["2026-1-01", "2026-01-01"], ["2026-02-30", "2026-02-30"],
    ["2025-02-29", "2025-02-29"], ["2026-02-02", "2026-02-02"],
    ["2026-01-02", "2026-01-01"], ["2025-12-31", "2026-01-31"],
  ]) {
    const result = await service({ credentialRef, startDate, endDate });
    assert.equal(result.kind, "analytics-summary-error");
    if (result.kind === "analytics-summary-error") assert.equal(result.code, "INVALID_INPUT");
  }
  assert.equal(authCalls, 0);
  assert.equal(providerCalls, 0);
  assert.equal(quotaCalls, 0);
});

test("maps missing auth and insufficient analytics scope to typed errors without querying", async () => {
  let providerCalls = 0;
  const makeService = (error: DomainError) => createYoutubeAnalyticsSummaryService({
    now: () => new Date("2026-02-01T12:00:00Z"),
    authResolver: { resolve: async () => { throw error; } },
    youtubeAnalyticsApi: { query: async () => { providerCalls++; return days; } },
  });
  const missing = await makeService(new DomainError({ code: "unauthorized", message: "No credentials" }))(args);
  assert.equal(missing.kind, "analytics-summary-error");
  if (missing.kind === "analytics-summary-error") assert.equal(missing.code, "AUTH_REQUIRED");
  const insufficient = await makeService(new DomainError({
    code: "AUTH_SCOPE_INSUFFICIENT", message: "Missing analytics scope",
  }))(args);
  assert.equal(insufficient.kind, "analytics-summary-error");
  if (insufficient.kind === "analytics-summary-error") {
    assert.equal(insufficient.code, "AUTH_SCOPE_INSUFFICIENT");
    assert.deepEqual(insufficient.requiredScopes, ["yt-analytics.readonly"]);
    assert.match(insufficient.message, /re.?authoriz/i);
  }
  assert.equal(providerCalls, 0);
});

test("records a fallback operation ID when its factory throws without changing provider success", async () => {
  const records: { operationId: string; operation: string }[] = [];
  let providerCalls = 0;
  const service = createYoutubeAnalyticsSummaryService({
    now: () => new Date("2026-02-01T12:00:00Z"),
    operationIdFactory: () => { throw new Error("ID generation unavailable"); },
    authResolver: { resolve: async () => credentials },
    youtubeAnalyticsApi: { query: async () => { providerCalls++; return days; } },
    quotaAccountant: { record: (entry) => { records.push(entry); } },
  });

  assert.deepEqual(await service(args), {
    kind: "analytics-summary", startDate: args.startDate, endDate: args.endDate, days,
  });
  assert.equal(providerCalls, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].operation, "reports.query");
  assert.equal(typeof records[0].operationId, "string");
  assert.ok(records[0].operationId.trim().length > 0);
});

test("records one reports.query per provider attempt, awaiting and isolating accounting failures", async () => {
  for (const providerFails of [false, true]) {
    const records: unknown[] = [];
    let finishRecord: (() => void) | undefined;
    let completed = false;
    const service = createYoutubeAnalyticsSummaryService({
      now: () => new Date("2026-02-01T12:00:00Z"),
      operationIdFactory: () => "query-1",
      authResolver: { resolve: async () => credentials },
      youtubeAnalyticsApi: { query: async () => {
        if (providerFails) throw new Error("provider unavailable");
        return days;
      } },
      quotaAccountant: { record: (entry) => {
        records.push(entry);
        return new Promise<void>((resolve) => { finishRecord = resolve; }).then(() => {
          throw new Error("accounting unavailable");
        });
      } },
    });
    const pending = service(args).then((result) => { completed = true; return result; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(records, [{ operationId: "query-1", operation: "reports.query" }]);
    assert.equal(completed, false);
    assert.ok(finishRecord);
    finishRecord();
    const result = await pending;
    assert.equal(result.kind, providerFails ? "analytics-summary-error" : "analytics-summary");
    if (result.kind === "analytics-summary-error") assert.equal(result.code, "ANALYTICS_API_ERROR");
    else assert.deepEqual(result.days, days);
    assert.equal(records.length, 1);
  }
});
