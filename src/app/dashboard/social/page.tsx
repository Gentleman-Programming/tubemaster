"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { use, useState } from "react";
import type { SocialAccount } from "@/lib/social/contracts";
import { SocialAccountsPanel } from "@/components/social-accounts-panel";
import { SocialComposer } from "@/components/social-composer";
import { SocialQueue } from "@/components/social-queue";
import { Card, SectionHeader } from "@/components/ui";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

export default function SocialPage({ searchParams }: { searchParams: SearchParams }) {
  const query = use(searchParams);
  const { status } = useSession();
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [queueVersion, setQueueVersion] = useState(0);

  if (status === "loading") return <p role="status" className="font-mono text-sm text-subtle">Loading…</p>;
  if (status !== "authenticated") redirect("/");

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Social publishing</h1>
        <p className="mt-2 max-w-3xl text-sm text-subtle">
          Publish or schedule videos to TikTok and Instagram. Every post is previewed and needs your confirmation; nothing is
          posted automatically.
        </p>
      </div>
      <SocialAccountsPanel connected={single(query.connected)} error={single(query.error)} onAccountsChange={setAccounts} />
      <Card aria-labelledby="social-composer-heading" className="space-y-5">
        <SectionHeader
          title={<span id="social-composer-heading">New post</span>}
          description="Choose a video and caption, preview it, then confirm."
        />
        <SocialComposer accounts={accounts} onQueueChange={() => setQueueVersion((version) => version + 1)} />
      </Card>
      <SocialQueue refreshKey={queueVersion} />
    </main>
  );
}
