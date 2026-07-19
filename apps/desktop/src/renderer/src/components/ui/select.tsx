import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Нативный select со своей стрелкой: системная рисуется движком впритык
 * к краю и не слушается паддингов, поэтому appearance-none + ChevronDown.
 * className задаёт ширину и внешние отступы — он идёт на обёртку.
 */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        data-slot="select"
        className="border-input focus-visible:border-ring/60 focus-visible:ring-ring/30 h-9 w-full appearance-none rounded-md border bg-transparent py-1 pr-8 pl-3 text-sm shadow-xs outline-none focus-visible:ring-2"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-soft" />
    </div>
  );
}

export { Select };
