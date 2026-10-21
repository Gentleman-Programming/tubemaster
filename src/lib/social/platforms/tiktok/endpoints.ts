// TikTok Login Kit v2 and Content Posting API endpoints, as known from the v2 docs.
// Confirm them against https://developers.tiktok.com/doc/content-posting-api-get-started
// during the first real run.
export const TIKTOK_ENDPOINTS = {
  authorize: "https://www.tiktok.com/v2/auth/authorize/",
  token: "https://open.tiktokapis.com/v2/oauth/token/",
  userInfo: "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name",
  creatorInfo: "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
  videoInit: "https://open.tiktokapis.com/v2/post/publish/video/init/",
  status: "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
} as const;

export const TIKTOK_SCOPES = ["user.info.basic", "video.publish"] as const;
