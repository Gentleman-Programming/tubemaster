// Facebook Login for Business and Instagram Graph API endpoints, as known from the Meta docs.
// The Graph version, URLs and permissions must be confirmed during the first real run against
// https://developers.facebook.com/docs/instagram-platform/content-publishing and
// https://developers.facebook.com/docs/instagram-platform/content-publishing/resumable-uploads
export const INSTAGRAM_GRAPH_VERSION = "v21.0";

const GRAPH = `https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}`;
const id = (value: string) => encodeURIComponent(value);

export const INSTAGRAM_ENDPOINTS = {
  version: INSTAGRAM_GRAPH_VERSION,
  authorize: `https://www.facebook.com/${INSTAGRAM_GRAPH_VERSION}/dialog/oauth`,
  token: `${GRAPH}/oauth/access_token`,
  /** Pages the user manages, with the Instagram professional account linked to each. */
  pages: `${GRAPH}/me/accounts?fields=name,instagram_business_account{id,username}`,
  media: (igUserId: string) => `${GRAPH}/${id(igUserId)}/media`,
  mediaPublish: (igUserId: string) => `${GRAPH}/${id(igUserId)}/media_publish`,
  containerStatus: (containerId: string) => `${GRAPH}/${id(containerId)}?fields=status_code,status`,
  upload: (containerId: string) => `https://rupload.facebook.com/ig-api-upload/${INSTAGRAM_GRAPH_VERSION}/${id(containerId)}`,
} as const;

export const INSTAGRAM_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
] as const;
