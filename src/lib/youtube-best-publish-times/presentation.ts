import type {
  BestPublishTimesErrorCode,
  BestPublishTimesResponse,
  BestPublishTimesResult,
  PublishSlot,
} from "./contracts";

export type BestPublishTimesSlotView = {
  rank: number;
  label: string;
  scoreLabel: string;
  sampleLabel: string;
};

export type BestPublishTimesView =
  | {
      kind: "result";
      timezone: string;
      slots: BestPublishTimesSlotView[];
      lowConfidence: boolean;
      confidenceNotice: string | null;
      emptyMessage: string | null;
      countsLabel: string;
      method: BestPublishTimesResult["method"];
    }
  | { kind: "error"; message: string };

const hour = (value: number) => `${String(value).padStart(2, "0")}:00`;
const videos = (count: number) => `${count} ${count === 1 ? "video" : "videos"}`;

export function formatSlot(slot: Pick<PublishSlot, "weekday" | "startHour" | "endHour">): string {
  const weekday = slot.weekday.charAt(0).toUpperCase() + slot.weekday.slice(1);
  return `${weekday} ${hour(slot.startHour)}–${hour(slot.endHour)}`;
}

export function formatScore(score: number): string {
  return `${score.toFixed(1)}× your channel median`;
}

export function bestPublishTimesErrorMessage(code: BestPublishTimesErrorCode | undefined, message?: string): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "Sign in to see your best publish times.";
    case "AUTH_SCOPE_INSUFFICIENT":
      return "Sign in again to grant YouTube Analytics access (yt-analytics.readonly).";
    case "INVALID_INPUT":
      return message ? `Invalid request: ${message}` : "Invalid request.";
    case "ANALYTICS_API_ERROR":
      return "YouTube Analytics could not be reached. Try again later.";
    default:
      return "Unable to load best publish times.";
  }
}

export function toBestPublishTimesView(response: BestPublishTimesResponse): BestPublishTimesView {
  if (response.kind === "best-publish-times-error") {
    return { kind: "error", message: bestPublishTimesErrorMessage(response.code, response.message) };
  }
  const { method } = response;
  const lowConfidence = response.confidence === "low";
  return {
    kind: "result",
    timezone: response.timezone,
    slots: response.slots.map((slot, index) => ({
      rank: index + 1,
      label: formatSlot(slot),
      scoreLabel: formatScore(slot.score),
      sampleLabel: videos(slot.sampleSize),
    })),
    lowConfidence,
    confidenceNotice: lowConfidence
      ? `Low confidence: only ${videos(response.analyzedVideos)} analyzed, or too few videos per slot. Treat these times as a rough hint.`
      : null,
    emptyMessage: response.slots.length
      ? null
      : `No time slot has at least ${method.minSlotSamples} videos yet. Publish more videos to get a recommendation.`,
    countsLabel: `${videos(response.analyzedVideos)} analyzed, ${response.excludedVideos} excluded (published less than ${method.minVideoAgeDays} days ago).`,
    method,
  };
}
