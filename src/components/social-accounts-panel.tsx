"use client";

import { useEffect, useState } from "react";
import { SOCIAL_PLATFORMS, type SocialAccount, type SocialPlatform } from "@/lib/social/contracts";
import {
  callSocialApi,
  connectBannerMessage,
  connectErrorMessage,
  platformChip,
  platformLabel,
  type SocialFetcher,
} from "@/lib/social/presentation";
import { Button, buttonClasses, Card, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";

export type SocialAccountsView = { kind: "result"; accounts: SocialAccount[] } | { kind: "error"; message: string };

const defaultFetcher: SocialFetcher = (url, init) => fetch(url, init);

export async function requestSocialAccounts(fetcher: SocialFetcher = defaultFetcher): Promise<SocialAccountsView> {
  const result = await callSocialApi<{ accounts?: SocialAccount[] }>(fetcher, "/api/social/accounts");
  if (!result.ok) return { kind: "error", message: result.message };
  return { kind: "result", accounts: Array.isArray(result.body.accounts) ? result.body.accounts : [] };
}

export async function disconnectSocialAccount(
  platform: SocialPlatform,
  fetcher: SocialFetcher = defaultFetcher,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await callSocialApi(fetcher, `/api/social/accounts?platform=${platform}`, { method: "DELETE" });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export function SocialAccountsContent({
  view,
  loading,
  connected,
  error,
  busyPlatform,
  actionMessage,
  onDisconnect,
}: {
  view: SocialAccountsView | null;
  loading: boolean;
  connected?: string | null;
  error?: string | null;
  busyPlatform?: SocialPlatform | null;
  actionMessage?: string | null;
  onDisconnect?: (platform: SocialPlatform) => void;
}) {
  const banner = connectBannerMessage(connected);
  const accounts = view?.kind === "result" ? view.accounts : [];
  return (
    <>
      {banner && (
        <p role="status" className="rounded-panel border border-mint/30 bg-mint/10 p-3 text-sm text-mint">
          {banner}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-panel border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {connectErrorMessage(error)}
        </p>
      )}
      {loading && <p role="status" className="font-mono text-sm text-subtle">Loading connected accounts...</p>}
      {!loading && view?.kind === "error" && <p role="alert" className="text-sm text-danger">{view.message}</p>}
      {!loading && view?.kind === "result" && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((platform) => {
            const account = accounts.find((item) => item.platform === platform);
            const chip = platformChip(platform);
            const label = chip.label;
            return (
              <li
                key={platform}
                className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-4 transition-colors hover:border-rose/30"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-subtle">
                    <span aria-hidden="true" className={cn("size-2 rounded-full", chip.dotClassName, !account && "opacity-40")} />
                    {label}
                  </p>
                  <p className={cn("mt-1 truncate font-semibold", account ? "text-fg" : "text-muted")}>
                    {account ? account.displayName : "Not connected"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* Full-page navigation: the connect route redirects to the platform's OAuth screen. */}
                  <a href={`/api/social/${platform}/connect`} className={buttonClasses(account ? "secondary" : "primary", "sm")}>
                    {account ? `Reconnect ${label}` : `Connect ${label}`}
                  </a>
                  {account && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyPlatform === platform}
                      onClick={() => onDisconnect?.(platform)}
                    >
                      Disconnect
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {actionMessage && <p role="status" aria-live="polite" className="text-sm text-dim">{actionMessage}</p>}
    </>
  );
}

export function SocialAccountsPanel({
  fetcher = defaultFetcher,
  connected,
  error,
  onAccountsChange,
}: {
  fetcher?: SocialFetcher;
  connected?: string | null;
  error?: string | null;
  onAccountsChange?: (accounts: SocialAccount[]) => void;
} = {}) {
  const [view, setView] = useState<SocialAccountsView | null>(null);
  const [busyPlatform, setBusyPlatform] = useState<SocialPlatform | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  function apply(next: SocialAccountsView) {
    setView(next);
    if (next.kind === "result") onAccountsChange?.(next.accounts);
  }

  useEffect(() => {
    let active = true;
    void requestSocialAccounts(fetcher).then((next) => {
      if (!active) return;
      setView(next);
      if (next.kind === "result") onAccountsChange?.(next.accounts);
    });
    return () => {
      active = false;
    };
  }, [fetcher, onAccountsChange]);

  async function disconnect(platform: SocialPlatform) {
    if (!window.confirm(`Disconnect ${platformLabel(platform)}? Scheduled posts for this account fail while it is disconnected.`)) return;
    setBusyPlatform(platform);
    const result = await disconnectSocialAccount(platform, fetcher);
    setActionMessage(result.ok ? `${platformLabel(platform)} disconnected.` : result.message);
    apply(await requestSocialAccounts(fetcher));
    setBusyPlatform(null);
  }

  return (
    <Card aria-labelledby="social-accounts-heading" className="space-y-4">
      <SectionHeader
        title={<span id="social-accounts-heading">Connected accounts</span>}
        description="Connect one TikTok and one Instagram account with your own developer apps."
      />
      <SocialAccountsContent
        view={view}
        loading={!view}
        connected={connected}
        error={error}
        busyPlatform={busyPlatform}
        actionMessage={actionMessage}
        onDisconnect={(platform) => void disconnect(platform)}
      />
    </Card>
  );
}
