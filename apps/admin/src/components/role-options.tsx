import { builtInRoleLabels, builtInRoleOrder, roleLabel } from "@pas/auth/permissions";
import { SelectGroup, SelectItem, SelectLabel, SelectSeparator } from "@pas/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { customRolesQuery, useOrganizationId } from "@/lib/organization";

export function RoleOptions({ allowOwner, current }: { allowOwner: boolean; current?: string }) {
  const organizationId = useOrganizationId();
  const custom = useQuery(customRolesQuery(organizationId));

  // Better Auth only lets the creator role grant owner.
  const builtIn = builtInRoleOrder.filter(
    (role) => allowOwner || role === current || role !== "owner",
  );

  const customNames = custom.data?.map((role) => role.role) ?? [];
  const known = new Set<string>([...builtIn, ...customNames]);

  return (
    <>
      {current && !known.has(current) && (
        <SelectItem value={current}>{roleLabel(current)}</SelectItem>
      )}
      <SelectGroup>
        <SelectLabel>Built-in</SelectLabel>
        {builtIn.map((role) => (
          <SelectItem key={role} value={role} description={builtInRoleLabels[role].description}>
            {builtInRoleLabels[role].label}
          </SelectItem>
        ))}
      </SelectGroup>
      {customNames.length > 0 && (
        <>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Custom</SelectLabel>
            {customNames.map((role) => (
              <SelectItem key={role} value={role}>
                {roleLabel(role)}
              </SelectItem>
            ))}
          </SelectGroup>
        </>
      )}
    </>
  );
}
