import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { quotaClient } from "@/lib/db";
import {
  createDurableQuotaAccountant,
  type QuotaAccountant,
} from "@/lib/quota/accountant";
import { DomainError } from "@/lib/video-metadata/contracts";
import { getVideoMetadataErrorStatus } from "@/app/api/video-metadata/error-status";
import { getAuthenticatedYoutube } from "@/lib/youtube";

type ChannelInfoRouteDeps = {
  getSession: () => Promise<{ user?: { id?: string | null } } | null>;
  getYoutube: typeof getAuthenticatedYoutube;
  createAccountant: (credentials: {
    credentialRef: { userId: string };
  }) => QuotaAccountant;
  operationIdFactory: () => string;
};

function accountQuota(accountant: QuotaAccountant, operationId: string): void {
  try {
    accountant.record({ operationId, operation: "channels.list" });
  } catch {
    // Quota accounting must never change the operation result.
  }
}

export function createChannelInfoGetHandler(
  deps: ChannelInfoRouteDeps = {
    getSession: () => getServerSession(authOptions),
    getYoutube: getAuthenticatedYoutube,
    createAccountant: ({ credentialRef }) =>
      createDurableQuotaAccountant({
        client: quotaClient,
        scope: { kind: "user", userId: credentialRef.userId },
      }),
    operationIdFactory: randomUUID,
  },
) {
  return async function GET() {
    const session = await deps.getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const operationId = deps.operationIdFactory();
    const accountant = deps.createAccountant({
      credentialRef: { userId: session.user.id },
    });
    accountQuota(accountant, operationId);

    try {
      const youtube = await deps.getYoutube(session.user.id);
      const res = await youtube.channels.list({
        part: ["snippet", "statistics"],
        mine: true,
      });

      const channel = res.data.items?.[0];
      if (!channel) {
        return NextResponse.json({ channel: null });
      }

      return NextResponse.json({
        channel: {
          id: channel.id,
          title: channel.snippet?.title,
          thumbnail: channel.snippet?.thumbnails?.default?.url,
          videoCount: channel.statistics?.videoCount,
        },
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return NextResponse.json(
          {
            error: error.code,
            message: error.message,
            details: error.details,
          },
          { status: getVideoMetadataErrorStatus(error.code) },
        );
      }

      return NextResponse.json(
        { error: "internal_error", message: "Internal server error" },
        { status: 500 },
      );
    }
  };
}

export const GET = createChannelInfoGetHandler();
