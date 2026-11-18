import type { Instant } from "@pas/kernel";

export interface ChangeRequestProps {
  id: string;
  policyId: string;
  kind: string;
  details: string;
  status: "open" | "closed";
  requestedBy: { type: "client"; userId: string; name: string; email: string };
  producerId: string;
  createdAt: Instant;
}
