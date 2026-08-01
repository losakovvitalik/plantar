import type { ReactNode } from "react";
import { TooltipProvider } from "./ui/tooltip";

/** App-wide tooltip settings in one place: tooltips open after 500 ms, and
 *  moving between adjacent triggers within 300 ms opens the next one instantly */
export function AppTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={300}>
      {children}
    </TooltipProvider>
  );
}
