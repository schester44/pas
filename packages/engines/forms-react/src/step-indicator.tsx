import { cn } from "@pas/ui/lib/utils";
import { Check } from "lucide-react";

interface StepIndicatorProps {
  steps: { id: string; title: string }[];
  current: number;
  label: string;
  onSelect: (index: number) => void;
  /** Steps after `current` up to this index can be opened too. */
  reachable?: number;
}

export function StepIndicator({
  steps,
  current,
  label,
  onSelect,
  reachable = current,
}: StepIndicatorProps) {
  return (
    <nav aria-label={label} className="grid gap-3">
      <p className="m-0 text-xs text-muted-foreground tabular-nums sm:hidden">{label}</p>
      <ol
        className="m-0 grid list-none gap-2 p-0"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          const open = !active && index <= Math.max(reachable, current);

          return (
            <li key={step.id} className="grid gap-2">
              <span
                aria-hidden
                className={cn("h-1 rounded-full", done || active ? "bg-primary" : "bg-muted")}
              />
              <button
                type="button"
                disabled={!open}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(index)}
                className={cn(
                  "hidden items-center gap-1.5 truncate rounded-sm text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                  open && "cursor-pointer hover:text-foreground",
                )}
              >
                {done && <Check aria-hidden className="size-3.5 shrink-0 text-primary" />}
                <span className="truncate">{step.title}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
