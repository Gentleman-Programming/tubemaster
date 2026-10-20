import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BestPublishTimesContent,
  requestBestPublishTimes,
} from "./best-publish-times-panel";

const result = {
  kind: "best-publish-times" as const,
  timezone: "America/Argentina/Buenos_Aires",
  analyzedVideos: 42,
  excludedVideos: 3,
  channelMedianEarlyViews: 1000,
  confidence: "normal" as const,
  slots: [{ weekday: "thursday" as const, startHour: 18, endHour: 21, score: 3.2, sampleSize: 4, medianEarlyViews: 3200 }],
  method: { maxVideos: 50, minVideoAgeDays: 4, earlyWindowDays: 3, slotHours: 3, minSlotSamples: 2 },
};

test("requests the endpoint with the encoded timezone", async () => {
  let requestUrl = "";
  const view = await requestBestPublishTimes("America/Argentina/Buenos_Aires", async (url) => {
    requestUrl = url;
    return Response.json(result);
  });
  assert.equal(requestUrl, "/api/youtube/best-publish-times?timezone=America%2FArgentina%2FBuenos_Aires");
  assert.equal(view.kind, "result");
});

test("maps API error bodies to the error view", async () => {
  const view = await requestBestPublishTimes("UTC", async () =>
    Response.json(
      { kind: "best-publish-times-error", code: "AUTH_SCOPE_INSUFFICIENT", message: "Reauthorization required", requiredScopes: ["yt-analytics.readonly"] },
      { status: 403 },
    ),
  );
  assert.equal(view.kind, "error");
  if (view.kind === "error") assert.match(view.message, /Sign in again to grant YouTube Analytics access/);
});

test("maps unreadable failures to a generic error view", async () => {
  const view = await requestBestPublishTimes("UTC", async () => new Response("oops", { status: 500 }));
  assert.equal(view.kind, "error");
  if (view.kind === "error") assert.match(view.message, /Unable to load best publish times/);
});

test("renders the ranked result with timezone and method explanation", async () => {
  const view = await requestBestPublishTimes("UTC", async () => Response.json(result));
  const html = renderToStaticMarkup(<BestPublishTimesContent view={view} timezone="UTC" loading={false} />);
  assert.match(html, /Thursday 18:00–21:00/);
  assert.match(html, /3\.2× your channel median/);
  assert.match(html, /America\/Argentina\/Buenos_Aires/);
  assert.match(html, /last 50 uploads/);
  assert.match(html, /never publishes or schedules/);
  assert.doesNotMatch(html, /Low confidence/);
});

test("renders low confidence, empty, error and loading states", async () => {
  const low = await requestBestPublishTimes("UTC", async () => Response.json({ ...result, confidence: "low", analyzedVideos: 5 }));
  assert.match(renderToStaticMarkup(<BestPublishTimesContent view={low} timezone="UTC" loading={false} />), /Low confidence/);

  const empty = await requestBestPublishTimes("UTC", async () => Response.json({ ...result, confidence: "low", slots: [] }));
  assert.match(renderToStaticMarkup(<BestPublishTimesContent view={empty} timezone="UTC" loading={false} />), /at least 2 videos/);

  const failed = await requestBestPublishTimes("UTC", async () =>
    Response.json({ kind: "best-publish-times-error", code: "ANALYTICS_API_ERROR", message: "boom" }, { status: 502 }),
  );
  assert.match(renderToStaticMarkup(<BestPublishTimesContent view={failed} timezone="UTC" loading={false} />), /role="alert"/);

  assert.match(renderToStaticMarkup(<BestPublishTimesContent view={null} timezone="UTC" loading />), /Loading best publish times/);
});
