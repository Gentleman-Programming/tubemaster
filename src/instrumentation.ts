export async function register() {
  // The worker needs Node.js APIs (filesystem, libsql); the Edge runtime never runs it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSocialWorker } = await import("./lib/social/worker");
    await startSocialWorker();
  }
}
