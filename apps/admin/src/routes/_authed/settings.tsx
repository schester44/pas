import { cn } from "@pas/ui/lib/utils";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useSettingsNav } from "@/components/settings-nav";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const groups = useSettingsNav();

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="shrink-0 border-b md:w-56 md:border-r md:border-b-0">
        <div className="hidden h-14 items-center border-b px-5 md:flex">
          <p className="m-0 text-sm font-semibold">Settings</p>
        </div>
        <nav aria-label="Settings" className="flex gap-1 overflow-x-auto px-3 md:hidden">
          {groups.flatMap((group) =>
            group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "-mb-px flex h-11 shrink-0 items-center border-b-2 border-transparent px-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                  "[&.active]:border-primary [&.active]:text-foreground",
                )}
              >
                {item.label}
              </Link>
            )),
          )}
        </nav>
        <nav aria-label="Settings" className="hidden gap-5 p-3 md:grid">
          {groups.map((group) => (
            <div key={group.label} className="grid gap-0.5">
              <p className="m-0 px-2 pb-1 text-xs font-medium text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors",
                    "hover:bg-muted/60 hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
                    "[&.active]:bg-muted [&.active]:text-foreground [&.active_svg]:text-primary",
                  )}
                >
                  {item.icon}
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
