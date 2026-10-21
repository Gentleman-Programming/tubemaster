"use client";

import { signIn, useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui";

export default function Home() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <p className="font-mono text-sm text-subtle">Loading...</p>
      </div>
    );
  }

  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-xl overflow-hidden rounded-card border border-line bg-surface shadow-glow">
        <div aria-hidden="true" className="flex h-10 items-center gap-3 border-b border-line-soft bg-panel/40 px-4">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-danger/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-warn/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-mint/80" />
          </span>
          <span className="font-mono text-xs text-muted">
            <span className="text-rose">~/</span>tubemaster
          </span>
        </div>

        <div className="flex flex-col items-center gap-8 px-6 py-10 text-center sm:px-10 sm:py-14">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              YouTube Playlist Manager
            </h1>
            <p className="mt-3 text-base text-subtle sm:text-lg">
              Create rules to automatically organize your videos into playlists
            </p>
          </div>

          <Button onClick={() => signIn("google")} className="shadow-button">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fg">
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
            </span>
            Sign in with Google
          </Button>
        </div>
      </div>
    </div>
  );
}
