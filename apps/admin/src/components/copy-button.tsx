import { Button } from "@pas/ui/components/button";
import { Check } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";

export function CopyButton({
  value,
  label = "Copy",
  icon,
  variant = "outline",
}: {
  value: string;
  label?: string;
  icon?: React.ReactNode;
  variant?: "outline" | "default";
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 1600);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className="min-w-24"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? <Check className="text-primary" /> : icon}
      {copied ? "Copied" : label}
    </Button>
  );
}
