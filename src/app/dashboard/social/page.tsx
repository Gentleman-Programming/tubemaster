"use client";

import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { use, useState } from "react";
import type { SocialAccount } from "@/lib/social/contracts";
import { SocialAccountsPanel } from "@/components/social-accounts-panel";
import { SocialComposer } from "@/components/social-composer";
import { SocialQueue } from "@/components/social-queue";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

export default function SocialPage({ searchParams }: { searchParams: SearchParams }) {
  const query = use(searchParams);
  const { status } = useSession();
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [queueVersion, setQueueVersion] = useState(0);

  if (status === "loading") return <p role="status">Loading…</p>;
  if (status !== "authenticated") redirect("/");

  return (
    <main className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Social publishing</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Publish or schedule videos to TikTok and Instagram. Every post is previewed and needs your confirmation; nothing is
          posted automatically.
        </p>
      </div>
      <SocialAccountsPanel connected={single(query.connected)} error={single(query.error)} onAccountsChange={setAccounts} />
      <section aria-labelledby="social-composer-heading" className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
        <div>
          <h2 id="social-composer-heading" className="text-xl font-semibold">New post</h2>
          <p className="mt-1 text-sm text-zinc-400">Choose a video and caption, preview it, then confirm.</p>
        </div>
        <SocialComposer accounts={accounts} onQueueChange={() => setQueueVersion((version) => version + 1)} />
      </section>
      <SocialQueue refreshKey={queueVersion} />
    </main>
  );
}
