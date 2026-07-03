import { forwardRef } from "react";
import { cn } from "../../lib/utils";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-none transition-shadow placeholder:text-ink-soft/50 focus-visible:border-moss/60 focus-visible:ring-2 focus-visible:ring-moss/30",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
