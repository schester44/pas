import type * as React from "react";
import { cn } from "../lib/utils";

/**
 * Sidebar on the canvas, the page on a white inset. Router-agnostic: the app renders its own links and
 * styles them with `navItemClassName`.
 */
function AppShell({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh bg-canvas">
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-6 px-3 py-4 md:flex">
        {sidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
        <main className="flex min-h-full flex-1 flex-col overflow-hidden bg-background md:rounded-xl md:border md:shadow-(--card-shadow)">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavSection({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <nav className="grid gap-0.5">
      {label && <p className="m-0 px-2 pb-1 text-xs font-medium text-muted-foreground">{label}</p>}
      {children}
    </nav>
  );
}

/** For router links: pair with the router's active-state class (e.g. TanStack's `[&.active]`). */
const navItemClassName = cn(
  "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors",
  "hover:bg-black/[0.03] hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
  "[&.active]:bg-card [&.active]:text-foreground [&.active]:shadow-xs [&.active]:ring-1 [&.active]:ring-border",
  "[&.active_svg]:text-primary",
);

export { AppShell, NavSection, navItemClassName };
