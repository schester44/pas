import { createPasAuthClient } from "@pas/auth/client";

export const authClient = createPasAuthClient(window.location.origin);
