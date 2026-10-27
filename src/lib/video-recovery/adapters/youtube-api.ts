import { createGoogleOAuthClient } from "../../auth";
import { createYoutubeClient } from "../../youtube";
import { mapProviderError } from "../../provider-errors";
import type { RecoveryProvider } from "../contracts";

function account(quotaAccountant: { record(entry: { operationId: string; operation: "videos.list" | "videos.update"; channelId?: string }): void }, operationId: string, operation: "videos.list" | "videos.update", channelId: string) {
  try { quotaAccountant.record({ operationId, operation, channelId }); } catch { /* quota accounting is observational */ }
}

function client(credentials: { accessToken: string; refreshToken?: string }) {
  const oauth = createGoogleOAuthClient();
  oauth.setCredentials({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken });
  return createYoutubeClient(oauth);
}

export const youtubeRecoveryProvider: RecoveryProvider = {
  async reconcile({ credentials, videoId, operationId, channelId, quotaAccountant }) {
    if (!videoId) return { status: "unsupported", reason: "provider_operation_identity_unavailable" };
    const youtube = client(credentials);
    account(quotaAccountant, operationId, "videos.list", channelId);
    try {
      const response = await youtube.videos.list({ part: ["snippet", "status"], id: [videoId] });
      const video = response.data.items?.[0];
      if (!video) return { status: "absent", channelId };
      return {
        status: "succeeded", videoId: video.id ?? videoId, channelId: video.snippet?.channelId ?? "",
        privacyStatus: video.status?.privacyStatus ?? "",
      };
    } catch (error) {
      if (mapProviderError(error, "update_failed").code === "not_found") return { status: "absent", channelId };
      throw error;
    }
  },
  async inspect({ credentials, videoId, operationId, channelId, quotaAccountant }) {
    const youtube = client(credentials);
    account(quotaAccountant, operationId, "videos.list", channelId);
    try {
      const response = await youtube.videos.list({ part: ["snippet", "status"], id: [videoId] });
      const video = response.data.items?.[0];
      if (!video) return null;
      return { videoId: video.id ?? videoId, channelId: video.snippet?.channelId ?? "", privacyStatus: video.status?.privacyStatus ?? "", publishAt: video.status?.publishAt };
    } catch (error) {
      if (mapProviderError(error, "update_failed").code === "not_found") return null;
      throw error;
    }
  },
  async returnToPrivate({ credentials, videoId, operationId, channelId, quotaAccountant }) {
    const youtube = client(credentials);
    account(quotaAccountant, operationId, "videos.update", channelId);
    await youtube.videos.update({ part: ["status"], requestBody: { id: videoId, status: { privacyStatus: "private" } } });
    return { status: "cancelled", videoId, channelId, privacyStatus: "private" };
  },
};
