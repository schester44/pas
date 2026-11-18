import type { SearchType } from "./query";

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  details: string[];
  status: string | null;
  policyId: string | null;
}
