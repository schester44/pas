import { Shield } from "lucide-react";
import type * as React from "react";
import { cn } from "../lib/utils";

/** Product mark + name. Placeholder until there's a real logo. */
function Brand({
  name = "PAS",
  logoUrl,
  className,
}: {
  name?: string;
  logoUrl?: string | null;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {logoUrl ? (
        <img src={logoUrl} alt="" className="size-7 shrink-0 rounded-lg object-contain" />
      ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
          <Shield className="size-4" strokeWidth={2.25} aria-hidden />
        </span>
      )}
      <span className="truncate text-base font-semibold tracking-tight">{name}</span>
    </div>
  );
}

function luminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());

  if (!match?.[1]) return null;

  const value = Number.parseInt(match[1], 16);

  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255;

    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

const WHITE = "oklch(1 0 0)";
const INK = "oklch(0.2 0 0)";

// White unless it misses AA (4.5:1) and near-black reads better.
function readableForeground(hex: string): string {
  const l = luminance(hex);

  if (l === null) return WHITE;

  const onWhite = 1.05 / (l + 0.05);
  const onInk = (l + 0.05) / 0.058;

  return onWhite >= 4.5 || onWhite >= onInk ? WHITE : INK;
}

function brandStyle(hex: string): React.CSSProperties {
  return {
    "--primary": hex,
    "--primary-foreground": readableForeground(hex),
  } as React.CSSProperties;
}

export { Brand, brandStyle, readableForeground };
