import { createGoogleOAuthClient } from "../../auth";
import { createYoutubeClient } from "../../youtube";
import type { ScheduleProvider } from "../contracts";

export const youtubeSchedulingProvider: ScheduleProvider = {
  async inspect({ credentials, videoId, operationId, channelId, quotaAccountant }) {
    const oauth = createGoogleOAuthClient();
    oauth.setCredentials({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken });
    const youtube = createYoutubeClient(oauth);
    try { quotaAccountant?.record({ operationId, operation: "videos.list", channelId }); } catch { /* best effort */ }
    const response = await youtube.videos.list({ part: ["snippet", "status"], id: [videoId] });
    const video = response.data.items?.[0];
    if (!video) return null;
    return { channelId: video.snippet?.channelId ?? "", privacyStatus: video.status?.privacyStatus ?? "", publishAt: video.status?.publishAt };
  },
  async schedule({ credentials, videoId, publishAtUtc, operationId, channelId, quotaAccountant }) {
    const oauth = createGoogleOAuthClient();
    oauth.setCredentials({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken });
    const youtube = createYoutubeClient(oauth);
    try { quotaAccountant.record({ operationId, operation: "videos.update", channelId }); } catch { /* best effort */ }
    await youtube.videos.update({ part: ["status"], requestBody: { id: videoId, status: { privacyStatus: "private", publishAt: publishAtUtc } } });
  },
};
