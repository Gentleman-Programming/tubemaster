import { getServerSession } from "next-auth";
import { authOptions, generateOAuthState, generatePkcePair } from "@/lib/auth";
import { createSocialOAuthState, serializeSocialOAuthCookie } from "@/lib/social/oauth-state";
import { loadTikTokOAuthConfig, type SocialOAuthRouteConfig } from "@/lib/social/platforms/tiktok";

export const runtime = "nodejs";

export type TikTokConnectDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  loadConfig: () => SocialOAuthRouteConfig;
  generateState?: () => string;
  generatePkce?: () => { verifier: string; challenge: string };
  now?: () => Date;
};

function redirect(location: string, setCookie?: string) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

export function createTikTokConnectHandler({
  getSession,
  loadConfig,
  generateState = generateOAuthState,
  generatePkce = generatePkcePair,
  now = () => new Date(),
}: TikTokConnectDeps) {
  return async function GET(request: Request) {
    const session = await getSession();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

    let config: SocialOAuthRouteConfig;
    try {
      config = loadConfig();
    } catch {
      return redirect(new URL("/dashboard/social?error=not_configured", request.url).toString());
    }

    const state = generateState();
    const pkce = generatePkce();
    const cookieValue = createSocialOAuthState({
      platform: "tiktok", state, codeVerifier: pkce.verifier, userId, secret: config.secret, now: now(),
    });
    const location = config.connector.authorizationUrl({ state, codeChallenge: pkce.challenge, redirectUri: config.redirectUri });
    return redirect(location, serializeSocialOAuthCookie("tiktok", cookieValue, config.env));
  };
}

export const GET = createTikTokConnectHandler({
  getSession: () => getServerSession(authOptions),
  loadConfig: () => loadTikTokOAuthConfig(),
});
