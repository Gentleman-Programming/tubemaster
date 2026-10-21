import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { quotaClient } from "@/lib/db";
import { isSocialPlatform, type SocialAccount } from "@/lib/social/contracts";
import { createSocialStorage, type SocialStorage } from "@/lib/social/storage";

export const runtime = "nodejs";

export type SocialAccountsDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  storage: () => Promise<Pick<SocialStorage, "listAccounts" | "deleteAccount">>;
};

/** Explicit allow-list so a future storage field can never leak through this endpoint. */
function toPublicAccount(account: SocialAccount): SocialAccount {
  const { id, userId, platform, externalAccountId, displayName, scopes, tokenExpiresAt, connectedAt } = account;
  return { id, userId, platform, externalAccountId, displayName, scopes, tokenExpiresAt, connectedAt };
}

export function createSocialAccountsHandlers({ getSession, storage }: SocialAccountsDeps) {
  async function requireUserId() {
    const session = await getSession();
    return session?.user?.id ?? null;
  }

  async function GET() {
    const userId = await requireUserId();
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
    try {
      const accounts = await (await storage()).listAccounts(userId);
      return Response.json({ accounts: accounts.map(toPublicAccount) });
    } catch {
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  }

  async function DELETE(request: Request) {
    const userId = await requireUserId();
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
    const platform = new URL(request.url).searchParams.get("platform");
    if (!isSocialPlatform(platform)) return Response.json({ error: "validation_failed" }, { status: 400 });
    try {
      return Response.json({ deleted: await (await storage()).deleteAccount(userId, platform) });
    } catch {
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  }

  return { GET, DELETE };
}

const handlers = createSocialAccountsHandlers({
  getSession: () => getServerSession(authOptions),
  storage: async () => createSocialStorage({ client: quotaClient, secret: process.env.NEXTAUTH_SECRET ?? "" }),
});

export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
