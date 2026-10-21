import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-panel border border-dashed border-line bg-glass px-6 py-10 text-center",
        className,
      )}
      {...props}
    >
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="max-w-md text-sm text-subtle">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
