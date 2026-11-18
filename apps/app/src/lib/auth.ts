import { createPasAuthClient } from "@pas/auth/client";
import { tenantHeaders } from "./trpc";

export const authClient = createPasAuthClient(window.location.origin, tenantHeaders);
