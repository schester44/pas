import { Button } from "@pas/ui/components/button";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

export function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 1500);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <li className="-mx-2 flex h-9 items-center gap-1 rounded-md px-2 hover:bg-muted/40">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="group flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium text-foreground"
      >
        <span className="truncate group-hover:underline">{url.replace(/^https?:\/\//, "")}</span>
        <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </a>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? <Check className="text-emerald-600" /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </li>
  );
}
