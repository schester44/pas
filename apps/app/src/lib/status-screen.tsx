import { Button } from "@pas/ui/components/button";
import type * as React from "react";

export function StatusScreen({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-canvas px-6 py-12">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-background text-muted-foreground shadow-xs ring-1 ring-border [&_svg]:size-5">
          {icon}
        </span>
        <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
        <p className="m-0 text-sm text-muted-foreground">{description}</p>
        {action && (
          <Button variant="outline" className="mt-4" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </main>
  );
}
