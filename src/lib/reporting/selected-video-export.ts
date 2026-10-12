export type ExportVideo = {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
};

export function selectLoadedVideos<T extends ExportVideo>(videos: readonly T[], selected: ReadonlySet<string>): ExportVideo[] {
  return videos.filter((video) => selected.has(video.videoId)).map(({ videoId, title, description, publishedAt }) => ({
    videoId, title, description, publishedAt,
  }));
}

export function serializeSelectedVideosJson(videos: readonly ExportVideo[]): string {
  return JSON.stringify(videos.map(({ videoId, title, description, publishedAt }) => ({
    videoId, title, description, publishedAt,
  })), null, 2);
}

function csvCell(value: string): string {
  // Spreadsheet applications may execute formula-looking provider text on opening CSV.
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) || safe !== value
    ? `"${safe.replaceAll('"', '""')}"`
    : safe;
}

export function serializeSelectedVideosCsv(videos: readonly ExportVideo[]): string {
  const rows = videos.map(({ videoId, title, description, publishedAt }) =>
    [videoId, title, description, publishedAt].map(csvCell).join(","));
  return ["videoId,title,description,publishedAt", ...rows].join("\r\n");
}
