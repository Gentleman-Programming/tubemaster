"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/upload", label: "Private upload" },
  { href: "/dashboard/quota", label: "Quota usage" },
  { href: "/dashboard/social", label: "Social publishing" },
];

/** Pure navigation list, rendered against an explicit pathname. */
export function DashboardNav({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Dashboard navigation" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {links.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative shrink-0 whitespace-nowrap rounded-control px-3 py-2 font-mono text-xs uppercase tracking-wider transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose",
              "before:absolute before:inset-x-3 before:bottom-0 before:h-0.5 before:rounded-full before:bg-rose before:opacity-0 before:transition-opacity md:before:inset-x-auto md:before:inset-y-2 md:before:left-0 md:before:h-auto md:before:w-0.5",
              active
                ? "bg-rose/10 text-rose before:opacity-100"
                : "text-subtle hover:bg-glass-2 hover:text-fg",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-3 md:gap-6">
      <div className="flex items-center gap-3 px-1">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-danger/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-warn/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-mint/80" />
        </span>
        <span className="font-mono text-sm font-semibold tracking-tight text-fg">
          <span className="text-rose">~/</span>tubemaster
        </span>
      </div>
      <DashboardNav pathname={pathname} />
    </div>
  );
}
