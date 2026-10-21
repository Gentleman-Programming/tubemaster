import { join } from "node:path";
import { createSocialWorker, type SocialWorker, type SocialWorkerDeps } from "./worker";

export { createSocialWorker, type SocialWorker, type SocialWorkerDeps } from "./worker";

type WorkerEnv = Record<string, string | undefined>;

const SINGLETON_KEY = Symbol.for("tubemaster.social-worker");
type Registry = { [SINGLETON_KEY]?: Promise<SocialWorker | null> };

export type StartSocialWorkerOptions = {
  env?: WorkerEnv;
  /** Holds the process-wide singleton; defaults to `globalThis` so dev reloads reuse the running worker. */
  registry?: object;
  createDeps?: (args: { secret: string; env: WorkerEnv }) => Promise<SocialWorkerDeps>;
  log?: (message: string) => void;
  intervalMs?: number;
};

function stderrLog(message: string): void {
  process.stderr.write(`[social-worker] ${message}\n`);
}

/** Production dependencies, loaded lazily because importing the db module opens the real database. */
async function createProductionDeps({ secret, env }: { secret: string; env: WorkerEnv }): Promise<SocialWorkerDeps> {
  const [{ quotaClient }, { createSocialStorage }, { loadPublishers }] = await Promise.all([
    import("../../db"),
    import("../storage"),
    import("./publishers"),
  ]);
  return {
    client: quotaClient,
    storage: createSocialStorage({ client: quotaClient, secret }),
    publishers: await loadPublishers(env),
    stagingRoot: env.VIDEO_UPLOAD_STAGING_ROOT ?? join(process.cwd(), "staging"),
  };
}

async function launch(options: StartSocialWorkerOptions): Promise<SocialWorker | null> {
  const env = options.env ?? process.env;
  const log = options.log ?? stderrLog;
  // Never publish from `next build` workers, even if they evaluate instrumentation.
  if (env.NEXT_PHASE === "phase-production-build") return null;
  if (env.SOCIAL_WORKER_DISABLED === "1") {
    log("disabled by SOCIAL_WORKER_DISABLED=1");
    return null;
  }
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) {
    log("NEXTAUTH_SECRET is not set; scheduled social posts will not be published");
    return null;
  }
  try {
    const deps = await (options.createDeps ?? createProductionDeps)({ secret, env });
    const worker = createSocialWorker({ logger: log, ...deps });
    const platforms = Object.keys(deps.publishers);
    log(`started (platforms: ${platforms.length > 0 ? platforms.join(", ") : "none configured"})`);
    // Not awaited: register() must not wait for uploads. start() never rejects; the catch is a backstop.
    worker.start({ intervalMs: options.intervalMs }).catch(() => log("worker loop stopped unexpectedly"));
    return worker;
  } catch (error) {
    log(`could not start (${error instanceof Error ? error.name : typeof error})`);
    return null;
  }
}

/**
 * Starts the in-app publishing worker once per process. Repeated calls (dev reloads, repeated
 * `register()` calls) return the same worker; the first call's outcome is final for the process.
 */
export function startSocialWorker(options: StartSocialWorkerOptions = {}): Promise<SocialWorker | null> {
  const registry = (options.registry ?? globalThis) as Registry;
  registry[SINGLETON_KEY] ??= launch(options);
  return registry[SINGLETON_KEY];
}
