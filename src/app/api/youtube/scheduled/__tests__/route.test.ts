import assert from "node:assert/strict";
import test from "node:test";
import { createScheduledVideosGetHandler } from "../route";
import type {
  ScheduledYoutubeVideosErrorCode,
  ScheduledYoutubeVideosResponse,
} from "@/lib/youtube-schedule-calendar";

type Session = { user?: { id?: string | null } } | null;
type CoreArgs = { credentialRef: { userId: string } };

const session = async (): Promise<Session> => ({ user: { id: "u1" } });
const success: ScheduledYoutubeVideosResponse = {
  kind: "youtube-scheduled-videos",
  videos: [{ videoId: "v1", title: "Video", publishAt: "2026-11-01T10:00:00Z" }],
};
const error = (code: ScheduledYoutubeVideosErrorCode | "UNEXPECTED") =>
  ({ kind: "youtube-scheduled-videos-error", code, message: "error" }) as ScheduledYoutubeVideosResponse;

const handler = (
  result: ScheduledYoutubeVideosResponse,
  getSession: () => Promise<Session> = session,
  calls: CoreArgs[] = [],
) =>
  createScheduledVideosGetHandler({
    getSession,
    core: {
      fetchScheduledVideos: async (args) => {
        calls.push(args);
        return result;
      },
    },
  });

test("returns 401 without a session and never calls the core", async () => {
  const calls: CoreArgs[] = [];
  const response = await handler(success, async () => null, calls)();

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    kind: "youtube-scheduled-videos-error",
    code: "AUTH_REQUIRED",
    message: "Authentication required",
  });
  assert.equal(calls.length, 0);
});

test("returns 200 with the scheduled videos for the session user", async () => {
  const calls: CoreArgs[] = [];
  const response = await handler(success, session, calls)();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), success);
  assert.deepEqual(calls, [{ credentialRef: { userId: "u1" } }]);
});

test("maps each error code to its status and returns the error body", async () => {
  const cases: Array<[ScheduledYoutubeVideosResponse, number]> = [
    [error("AUTH_REQUIRED"), 401],
    [error("AUTH_SCOPE_INSUFFICIENT"), 403],
    [error("YOUTUBE_API_ERROR"), 502],
    [error("UNEXPECTED"), 500],
  ];
  for (const [result, expected] of cases) {
    const response = await handler(result)();
    assert.equal(response.status, expected);
    assert.deepEqual(await response.json(), result);
  }
});

test("sanitizes unexpected core exceptions with a 500 response", async () => {
  const response = await createScheduledVideosGetHandler({
    getSession: session,
    core: {
      fetchScheduledVideos: async () => {
        throw new Error("sensitive provider details");
      },
    },
  })();

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    kind: "youtube-scheduled-videos-error",
    code: "YOUTUBE_API_ERROR",
    message: "Internal error",
  });
});
