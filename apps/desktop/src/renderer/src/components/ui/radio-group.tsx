import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "../../lib/utils";

export const RadioGroup = RadioGroupPrimitive.Root;

/** Крупная карточка-опция: заголовок + пояснение, вместо мелкой радиокнопки */
export function RadioCard({
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
      className={cn(
        "rounded-lg border border-line bg-card p-3 text-left outline-none transition-colors hover:border-moss/40 focus-visible:ring-2 focus-visible:ring-moss/40 data-[state=checked]:border-moss data-[state=checked]:bg-moss/5",
        className,
      )}
      {...props}
    >
      <div className="text-sm font-semibold text-ink">{title}</div>
      <div className="mt-0.5 text-[12.5px] leading-snug text-ink-soft">{description}</div>
    </RadioGroupPrimitive.Item>
  );
}
