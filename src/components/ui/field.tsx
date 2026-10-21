import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

const controlClasses =
  "w-full rounded-control border border-line bg-surface px-3 text-sm text-fg placeholder:text-muted transition-colors hover:border-rose/30 focus-visible:border-rose focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-dim", className)} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(controlClasses, "h-10", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(controlClasses, "h-10 pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(controlClasses, "min-h-24 py-2", className)} {...props} />;
}

export function FieldHint({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted", className)} {...props} />;
}

export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return <p role="alert" className={cn("text-xs text-danger", className)} {...props} />;
}
