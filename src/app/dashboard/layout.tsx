"use client";

import { useSession } from "next-auth/react";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();

  // The quota page retains its own unauthorized state; never expose the shell to visitors.
  if (status !== "authenticated") return <>{children}</>;

  return (
    <div className="min-h-screen bg-canvas md:grid md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="sticky top-0 z-20 min-w-0 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur md:h-screen md:border-r md:border-b-0 md:px-4 md:py-6">
        <DashboardSidebar />
      </aside>
      <div className="min-w-0">
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <DashboardHeader />
          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
