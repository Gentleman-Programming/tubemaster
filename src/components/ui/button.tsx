import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-control border font-medium transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-rose text-canvas hover:bg-pink hover:shadow-button",
  secondary: "border-line bg-surface-2 text-fg hover:border-rose/40 hover:bg-surface-3",
  ghost: "border-transparent bg-transparent text-dim hover:bg-glass-2 hover:text-fg",
  danger: "border-danger/40 bg-danger/10 text-danger hover:border-danger hover:bg-danger/20",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

/** Button styles for non-button elements such as `<a>` or `<Link>`. */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cn(baseClasses, variantClasses[variant], sizeClasses[size], className);
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}
