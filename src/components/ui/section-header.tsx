import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SectionHeaderProps = Omit<ComponentProps<"header">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  headingLevel?: 1 | 2 | 3;
};

export function SectionHeader({
  title,
  description,
  eyebrow,
  actions,
  headingLevel = 2,
  className,
  ...props
}: SectionHeaderProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-4", className)} {...props}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <span className="font-mono text-xs uppercase tracking-widest text-rose">{eyebrow}</span> : null}
        <Heading className="text-xl font-semibold text-fg">{title}</Heading>
        {description ? <p className="text-sm text-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
