import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Shared by section/div/article, so no element-specific `ref` is exposed.
export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "article";
};

export function Card({ as: Element = "section", className, ...props }: CardProps) {
  return <Element className={cn("rounded-card border border-line bg-surface-2 p-5", className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-base font-semibold text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-subtle", className)} {...props} />;
}
