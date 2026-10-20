import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { quotaClient } from "@/lib/db";
import { clearSocialOAuthCookie, readCookie, socialOAuthCookieName, verifySocialOAuthState } from "@/lib/social/oauth-state";
import { InstagramNoBusinessAccountError, loadInstagramOAuthConfig } from "@/lib/social/platforms/instagram";
import type { SocialOAuthRouteConfig } from "@/lib/social/platforms/tiktok";
import { createSocialStorage, type SocialStorage } from "@/lib/social/storage";

export const runtime = "nodejs";

export type InstagramCallbackDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  loadConfig: () => SocialOAuthRouteConfig;
  storage: () => Promise<Pick<SocialStorage, "upsertAccount">>;
  now?: () => Date;
};

type CallbackError =
  | "access_denied"
  | "invalid_state"
  | "not_configured"
  | "no_instagram_business_account"
  | "exchange_failed"
  | "storage_failed";

export function createInstagramCallbackHandler({ getSession, loadConfig, storage, now = () => new Date() }: InstagramCallbackDeps) {
  return async function GET(request: Request) {
    const session = await getSession();
    const userId = session?.user?.id;
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

    let clearCookie: string | undefined;
    // Every outcome is a redirect to the dashboard; provider and storage details never reach the URL.
    const finish = (query: string) => {
      const headers = new Headers({ Location: new URL(`/dashboard/social?${query}`, request.url).toString(), "Cache-Control": "no-store" });
      if (clearCookie) headers.append("Set-Cookie", clearCookie);
      return new Response(null, { status: 302, headers });
    };
    const fail = (code: CallbackError) => finish(`error=${code}`);

    let config: SocialOAuthRouteConfig;
    try {
      config = loadConfig();
      clearCookie = clearSocialOAuthCookie("instagram", config.env);
    } catch {
      return fail("not_configured");
    }

    const params = new URL(request.url).searchParams;
    if (params.get("error")) return fail("access_denied");

    const code = params.get("code");
    const verified = verifySocialOAuthState(readCookie(request, socialOAuthCookieName("instagram")), {
      platform: "instagram", state: params.get("state") ?? "", userId, secret: config.secret, now: now(),
    });
    if (!code || !verified) return fail("invalid_state");

    let connection: Awaited<ReturnType<SocialOAuthRouteConfig["connector"]["exchangeCode"]>>;
    try {
      connection = await config.connector.exchangeCode({ code, codeVerifier: verified.codeVerifier, redirectUri: config.redirectUri });
    } catch (error) {
      return fail(error instanceof InstagramNoBusinessAccountError ? "no_instagram_business_account" : "exchange_failed");
    }

    try {
      await (await storage()).upsertAccount(userId, "instagram", connection.profile, connection.tokens);
    } catch {
      return fail("storage_failed");
    }
    return finish("connected=instagram");
  };
}

export const GET = createInstagramCallbackHandler({
  getSession: () => getServerSession(authOptions),
  loadConfig: () => loadInstagramOAuthConfig(),
  storage: async () => createSocialStorage({ client: quotaClient, secret: process.env.NEXTAUTH_SECRET ?? "" }),
});
