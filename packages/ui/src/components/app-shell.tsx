import { ChevronRight, Menu } from "lucide-react";
import { Collapsible as CollapsiblePrimitive, Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "../lib/utils";

function AppShell({
  sidebar,
  mobileTitle,
  banner,
  children,
}: {
  sidebar: React.ReactNode;
  mobileTitle?: React.ReactNode;
  /** A one-line strip pinned above everything, e.g. the sandbox banner. */
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  return (
    <div
      className={cn(
        "flex min-h-svh flex-col bg-canvas md:flex-row",
        banner ? "[--shell-top:2rem]" : "[--shell-top:0px]",
      )}
    >
      {banner && <div className="fixed inset-x-0 top-0 z-30 h-8">{banner}</div>}
      <aside className="sticky top-(--shell-top) mt-(--shell-top) hidden h-[calc(100svh-var(--shell-top))] w-60 shrink-0 flex-col gap-6 px-3 py-4 md:flex">
        {sidebar}
      </aside>
      <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
        <header className="sticky top-(--shell-top) z-20 mt-(--shell-top) flex h-12 items-center gap-2 border-b bg-canvas/95 px-2 backdrop-blur md:hidden">
          <DialogPrimitive.Trigger className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-black/[0.03] hover:text-foreground">
            <Menu className="size-5" />
            <span className="sr-only">Open navigation</span>
          </DialogPrimitive.Trigger>
          <div className="min-w-0 truncate text-sm font-semibold">{mobileTitle}</div>
        </header>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 md:hidden" />
          <DialogPrimitive.Content
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a")) setDrawerOpen(false);
            }}
            className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-6 border-r bg-canvas px-3 py-4 shadow-lg data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left md:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            {sidebar}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
      <div className="flex min-w-0 flex-1 flex-col md:mt-(--shell-top) md:py-2 md:pr-2">
        <main className="flex min-h-full flex-1 flex-col overflow-hidden bg-background md:rounded-xl md:border md:shadow-(--card-shadow)">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavSection({
  label,
  collapsible,
  active = false,
  children,
}: {
  label?: string;
  collapsible?: boolean;
  /** The current route is inside this section; a collapsed section opens when this turns true. */
  active?: boolean;
  children: React.ReactNode;
}) {
  if (!label || !collapsible) {
    return (
      <nav className="grid gap-0.5">
        {label && (
          <p className="m-0 px-2 pb-1 text-xs font-medium text-muted-foreground">{label}</p>
        )}
        {children}
      </nav>
    );
  }

  return (
    <CollapsibleNavSection label={label} active={active}>
      {children}
    </CollapsibleNavSection>
  );
}

function CollapsibleNavSection({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = usePersistedOpen(`pas.nav.${label}`);

  React.useEffect(() => {
    if (active) setOpen(true);
  }, [active, setOpen]);

  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen} asChild>
      <nav className="grid gap-0.5">
        <CollapsiblePrimitive.Trigger className="group flex h-6 items-center gap-1 rounded-md px-2 text-left text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <span className="flex-1">{label}</span>
          <ChevronRight
            aria-hidden
            className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
          />
        </CollapsiblePrimitive.Trigger>
        <CollapsiblePrimitive.Content className="grid gap-0.5">
          {children}
        </CollapsiblePrimitive.Content>
      </nav>
    </CollapsiblePrimitive.Root>
  );
}

function usePersistedOpen(key: string) {
  const [open, setOpenState] = React.useState(() => readOpen(key));

  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenState(next);

      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Storage can be unavailable (private mode); the section just won't remember.
      }
    },
    [key],
  );

  return [open, setOpen] as const;
}

function readOpen(key: string) {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

const navItemClassName = cn(
  "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors",
  "hover:bg-black/[0.03] hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
  "[&.active]:bg-card [&.active]:text-foreground [&.active]:shadow-xs [&.active]:ring-1 [&.active]:ring-border",
  "[&.active_svg]:text-primary",
);

export { AppShell, NavSection, navItemClassName };
