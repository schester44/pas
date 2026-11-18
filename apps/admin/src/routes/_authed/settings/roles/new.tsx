import { createFileRoute } from "@tanstack/react-router";
import { RoleEditor } from "@/components/role-editor";

export const Route = createFileRoute("/_authed/settings/roles/new")({
  component: RoleEditor,
});
