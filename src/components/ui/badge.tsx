import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "rose" | "sky" | "mint" | "peach" | "danger" | "warn";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-line bg-glass-2 text-dim",
  rose: "border-rose/30 bg-rose/10 text-rose",
  sky: "border-sky/30 bg-sky/10 text-sky",
  mint: "border-mint/30 bg-mint/10 text-mint",
  peach: "border-peach/30 bg-peach/10 text-peach",
  danger: "border-danger/30 bg-danger/10 text-danger",
  warn: "border-warn/30 bg-warn/10 text-warn",
};

export type BadgeProps = ComponentProps<"span"> & {
  tone?: BadgeTone;
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
