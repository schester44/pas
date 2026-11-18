import { Blocks, FlaskConical, Palette, ShieldCheck, Users } from "lucide-react";
import type * as React from "react";
import { type Access, useAccess } from "@/lib/permissions";
import type { FileRouteTypes } from "@/routeTree.gen";

export interface SettingsNavItem {
  to: Extract<FileRouteTypes["to"], `/settings/${string}`>;
  label: string;
  icon: React.ReactNode;
  visible: (access: Access) => boolean;
}

const settingsNav: { label: string; items: SettingsNavItem[] }[] = [
  {
    label: "Organization",
    items: [
      {
        to: "/settings/branding",
        label: "Branding",
        icon: <Palette />,
        visible: (access) => access.branding.view,
      },
      {
        to: "/settings/integrations",
        label: "Integrations",
        icon: <Blocks />,
        visible: (access) => access.branding.update,
      },
      {
        to: "/settings/sandbox",
        label: "Sandbox",
        icon: <FlaskConical />,
        visible: (access) => access.branding.update,
      },
    ],
  },
  {
    label: "Team",
    items: [
      {
        to: "/settings/members",
        label: "Members",
        icon: <Users />,
        visible: (access) => access.members.view,
      },
      {
        to: "/settings/roles",
        label: "Roles",
        icon: <ShieldCheck />,
        visible: (access) => access.roles.view,
      },
    ],
  },
];

export function useSettingsNav() {
  const access = useAccess();

  return settingsNav
    .map((group) => ({ ...group, items: group.items.filter((item) => item.visible(access)) }))
    .filter((group) => group.items.length > 0);
}
