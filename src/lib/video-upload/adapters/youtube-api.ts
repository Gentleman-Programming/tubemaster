import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createGoogleOAuthClient } from "../../auth";
import { createYoutubeClient } from "../../youtube";
import type { UploadFileSource, UploadProvider } from "../contracts";

export const localUploadFiles: UploadFileSource = {
  async inspect(path) {
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) throw new Error("Not a non-empty regular file");
    const handle = await open(path, "r");
    await handle.close();
    return { size: info.size, open: () => createReadStream(path) };
  },
};

export const youtubeUploadProvider: UploadProvider = {
  async insert({ credentials, file, title, description, tags, categoryId, defaultLanguage, defaultAudioLanguage, license, selfDeclaredMadeForKids, containsSyntheticMedia, operationId, channelId, quotaAccountant }) {
    const oauth = createGoogleOAuthClient();
    oauth.setCredentials({ access_token: credentials.accessToken, refresh_token: credentials.refreshToken });
    const youtube = createYoutubeClient(oauth);
    try {
      quotaAccountant?.record({ operationId, operation: "videos.insert", channelId });
    } catch {
      // Quota estimates must not affect provider requests.
    }
    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: { title, description, tags, categoryId, defaultLanguage, defaultAudioLanguage },
        status: { privacyStatus: "private", license, selfDeclaredMadeForKids, containsSyntheticMedia },
      },
      media: { body: file.open() },
    });
    return response.data.id ?? "";
  },
};
