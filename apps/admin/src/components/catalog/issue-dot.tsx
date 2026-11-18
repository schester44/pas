import { cn } from "@pas/ui/lib/utils";

export function IssueDot({ severity }: { severity: "error" | "warning" | "ok" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "mt-1.5 size-2 shrink-0 rounded-full",
        severity === "error" && "bg-red-500",
        severity === "warning" && "bg-amber-500",
        severity === "ok" && "bg-emerald-500",
      )}
    />
  );
}
