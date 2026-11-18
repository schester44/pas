import { ToggleGroup } from "radix-ui";
import type * as React from "react";
import { cn } from "../lib/utils";

interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: React.ReactNode; disabled?: boolean }[];
  label: string;
  className?: string;
}

function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(next) => next && onValueChange(next as T)}
      aria-label={label}
      className={cn("inline-flex h-8 items-center gap-0.5 rounded-md bg-muted p-0.5", className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors",
            "hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export { SegmentedControl };
