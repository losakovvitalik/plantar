import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { CircleIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "border-input text-primary focus-visible:ring-ring/40 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

/** Кастомное дополнение к shadcn radio-group: крупная карточка-опция с заголовком и пояснением */
function RadioCard({
  className,
  title,
  description,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> & {
  title: string;
  description: string;
}) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-card"
      className={cn(
        "border-input bg-card hover:border-ring/40 focus-visible:ring-ring/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary/5 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2",
        className,
      )}
      {...props}
    >
      <div className="text-foreground text-sm font-semibold">{title}</div>
      <div className="text-muted-foreground mt-0.5 text-[12.5px] leading-snug">{description}</div>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioCard, RadioGroup, RadioGroupItem };
