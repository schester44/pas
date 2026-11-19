import type { TenantContext } from "@pas/kernel";
import type { GetClientAccount } from "@pas/parties";
import type { GetPolicy, PolicyScope } from "@pas/policy";
import type { SubmissionScope } from "@pas/submissions";

type GetSubmission = (
  ctx: TenantContext,
  scope: SubmissionScope,
  input: { id: string },
) => Promise<{
  id: string;
  number: string;
  status: string;
  productName: string;
  updatedAt: string;
}>;

const RECENT = 10;

/** The admin client page: the account, its policies and their submissions, and recent activity. */
export function makeClientDetail(deps: {
  account: GetClientAccount;
  policies: GetPolicy;
  submission: GetSubmission;
}) {
  return async function clientDetail(
    ctx: TenantContext,
    scope: PolicyScope & SubmissionScope,
    input: { id: string },
  ) {
    const account = await deps.account(ctx, input);
    const ids = [...new Set(account.policies.map((p) => p.id))];

    const policies = await Promise.all(
      ids.map((id) => deps.policies.detail(ctx, scope, { id }).catch(() => null)),
    );

    const found = policies.filter((p) => p !== null);

    const submissions = await Promise.all(
      [...new Set(found.map((p) => p.sourceSubmissionId))].map((id) =>
        deps.submission(ctx, scope, { id }).catch(() => null),
      ),
    );

    return {
      ...account,
      policies: found.map((p) => ({
        id: p.id,
        number: p.number,
        productName: p.productName,
        status: p.status,
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
        total: p.total,
        roles: account.policies.filter((l) => l.id === p.id).map((l) => l.role),
      })),
      submissions: submissions
        .filter((s) => s !== null)
        .map((s) => ({
          id: s.id,
          number: s.number,
          status: s.status,
          productName: s.productName,
          updatedAt: s.updatedAt,
        })),
      activity: found
        .flatMap((p) =>
          p.events.map((e) => ({
            id: e.id,
            policyId: p.id,
            policyNumber: p.number,
            type: e.type,
            summary: e.summary,
            occurredAt: e.occurredAt,
          })),
        )
        .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, RECENT),
    };
  };
}
