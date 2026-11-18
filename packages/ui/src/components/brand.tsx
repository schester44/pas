import { Shield } from "lucide-react";
import { cn } from "../lib/utils";

/** Product mark + name. Placeholder until there's a real logo. */
function Brand({ name = "PAS", className }: { name?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
        <Shield className="size-4" strokeWidth={2.25} aria-hidden />
      </span>
      <span className="text-base font-semibold tracking-tight">{name}</span>
    </div>
  );
}

export { Brand };
