import { useRouter } from "@tanstack/react-router";
import { authClient } from "./auth";
import { queryClient } from "./trpc";

export function useSwitchOrganization() {
  const router = useRouter();

  return async (organizationId: string) => {
    await authClient.organization.setActive({ organizationId });
    await router.invalidate();
    await queryClient.resetQueries();
  };
}

export function useSignOut() {
  const router = useRouter();

  return async () => {
    await authClient.signOut();
    queryClient.clear();
    await router.navigate({ to: "/login" });
  };
}
