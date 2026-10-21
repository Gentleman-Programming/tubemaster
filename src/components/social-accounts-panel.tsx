"use client";

import { useEffect, useState } from "react";
import { SOCIAL_PLATFORMS, type SocialAccount, type SocialPlatform } from "@/lib/social/contracts";
import {
  callSocialApi,
  connectBannerMessage,
  connectErrorMessage,
  platformLabel,
  type SocialFetcher,
} from "@/lib/social/presentation";

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

const buttonClass =
  "rounded-lg border border-zinc-600 px-3 py-1.5 text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

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
        <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {banner}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {connectErrorMessage(error)}
        </p>
      )}
      {loading && <p role="status" className="text-sm text-zinc-400">Loading connected accounts...</p>}
      {!loading && view?.kind === "error" && <p role="alert" className="text-sm text-red-300">{view.message}</p>}
      {!loading && view?.kind === "result" && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_PLATFORMS.map((platform) => {
            const account = accounts.find((item) => item.platform === platform);
            const label = platformLabel(platform);
            return (
              <li key={platform} className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
                  <p className="mt-1 font-semibold text-white">{account ? account.displayName : "Not connected"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {/* Full-page navigation: the connect route redirects to the platform's OAuth screen. */}
                  <a href={`/api/social/${platform}/connect`} className={buttonClass}>
                    {account ? `Reconnect ${label}` : `Connect ${label}`}
                  </a>
                  {account && (
                    <button
                      type="button"
                      disabled={busyPlatform === platform}
                      onClick={() => onDisconnect?.(platform)}
                      className={buttonClass}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {actionMessage && <p role="status" aria-live="polite" className="text-sm text-zinc-300">{actionMessage}</p>}
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
    <section aria-labelledby="social-accounts-heading" className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-5">
      <div>
        <h2 id="social-accounts-heading" className="text-xl font-semibold">Connected accounts</h2>
        <p className="mt-1 text-sm text-zinc-400">Connect one TikTok and one Instagram account with your own developer apps.</p>
      </div>
      <SocialAccountsContent
        view={view}
        loading={!view}
        connected={connected}
        error={error}
        busyPlatform={busyPlatform}
        actionMessage={actionMessage}
        onDisconnect={(platform) => void disconnect(platform)}
      />
    </section>
  );
}
