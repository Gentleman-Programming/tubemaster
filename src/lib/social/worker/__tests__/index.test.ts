import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";
import { createSocialStorage, initializeSocialTables } from "../../storage";
import { startSocialWorker, type StartSocialWorkerOptions } from "../index";
import { loadPublishers } from "../publishers";
import type { SocialWorkerDeps } from "../worker";

const SECRET = "test-nextauth-secret-value";

async function harness(t: test.TestContext, env: Record<string, string | undefined>) {
  const stagingRoot = await mkdtemp(join(tmpdir(), "social-worker-index-"));
  t.after(() => rm(stagingRoot, { recursive: true, force: true }));
  const client = createClient({ url: ":memory:" });
  await initializeSocialTables(client);
  const logs: string[] = [];
  const intervals: unknown[] = [];
  let depsCreated = 0;
  const options: StartSocialWorkerOptions = {
    env,
    registry: {},
    log: (message) => logs.push(message),
    createDeps: async ({ secret }): Promise<SocialWorkerDeps> => {
      depsCreated += 1;
      return {
        client,
        storage: createSocialStorage({ client, secret }),
        publishers: {},
        stagingRoot,
        timers: {
          setInterval: (callback) => {
            intervals.push(callback);
            return callback;
          },
          clearInterval: () => {},
        },
      };
    },
  };
  return { options, logs, intervals, depsCreated: () => depsCreated };
}

test("startSocialWorker starts a single worker per registry even when called repeatedly", async (t) => {
  const h = await harness(t, { NEXTAUTH_SECRET: SECRET });

  const [first, second] = await Promise.all([startSocialWorker(h.options), startSocialWorker(h.options)]);
  const third = await startSocialWorker(h.options);

  assert.ok(first);
  assert.equal(second, first);
  assert.equal(third, first);
  assert.equal(h.depsCreated(), 1);
  assert.equal(h.intervals.length, 1);
  first.stop();
});

test("startSocialWorker can be disabled with SOCIAL_WORKER_DISABLED=1", async (t) => {
  const h = await harness(t, { NEXTAUTH_SECRET: SECRET, SOCIAL_WORKER_DISABLED: "1" });

  assert.equal(await startSocialWorker(h.options), null);
  assert.equal(h.depsCreated(), 0);
  assert.equal(h.intervals.length, 0);
});

test("startSocialWorker skips with a single notice when NEXTAUTH_SECRET is missing", async (t) => {
  const h = await harness(t, {});

  assert.equal(await startSocialWorker(h.options), null);
  assert.equal(await startSocialWorker(h.options), null);
  assert.equal(h.depsCreated(), 0);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0], /NEXTAUTH_SECRET/);
});

test("startSocialWorker never runs during next build", async (t) => {
  const h = await harness(t, { NEXTAUTH_SECRET: SECRET, NEXT_PHASE: "phase-production-build" });

  assert.equal(await startSocialWorker(h.options), null);
  assert.equal(h.depsCreated(), 0);
});

test("startSocialWorker reports a dependency failure without throwing", async (t) => {
  const h = await harness(t, { NEXTAUTH_SECRET: SECRET });
  const options: StartSocialWorkerOptions = {
    ...h.options,
    createDeps: async () => {
      throw new Error("cannot open database");
    },
  };

  assert.equal(await startSocialWorker(options), null);
  assert.equal(h.logs.length, 1);
});

test("loadPublishers only enables platforms with configured credentials", async () => {
  assert.deepEqual(Object.keys(await loadPublishers({})), []);
  assert.deepEqual(Object.keys(await loadPublishers({ TIKTOK_CLIENT_KEY: "key" })), []);
  const publishers = await loadPublishers({ TIKTOK_CLIENT_KEY: "key", TIKTOK_CLIENT_SECRET: "secret" });
  assert.deepEqual(Object.keys(publishers), ["tiktok"]);
  assert.equal(publishers.tiktok?.platform, "tiktok");
});
