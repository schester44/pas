import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Resource → actions. Shared by server (enforcement) and SPAs (hiding UI).
 * RBAC only answers "may this role do X". Data scoping (an agent's own agency book, a
 * customer's own policies) is ABAC in the application layer.
 */
export const statements = {
  ...defaultStatements,
  product: ["read", "write", "publish"],
  decision: ["read", "write", "publish"],
  rating: ["read", "write", "publish"],
  document: ["read", "write", "publish"],
  submission: ["read", "create", "update"],
  quote: ["read", "bind"],
  uw: ["read", "refer", "approve", "override"],
  policy: ["read", "update"],
  transaction: ["create", "issue", "reverse"],
  billing: ["read", "write"],
  agency: ["read", "write"],
  compliance: ["read", "write"],
} as const;

export const ac = createAccessControl(statements);

const allConfig = {
  product: ["read", "write", "publish"],
  decision: ["read", "write", "publish"],
  rating: ["read", "write", "publish"],
  document: ["read", "write", "publish"],
} as const;

const allOps = {
  submission: ["read", "create", "update"],
  quote: ["read", "bind"],
  uw: ["read", "refer", "approve", "override"],
  policy: ["read", "update"],
  transaction: ["create", "issue", "reverse"],
  billing: ["read", "write"],
  agency: ["read", "write"],
  compliance: ["read", "write"],
} as const;

/** Built-in roles. Tenants can add custom roles at runtime (dynamic access control). */
export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, ...allConfig, ...allOps }),
  tenant_admin: ac.newRole({ ...adminAc.statements, ...allConfig, ...allOps }),
  product_manager: ac.newRole({
    ...memberAc.statements,
    ...allConfig,
    submission: ["read"],
    policy: ["read"],
  }),
  actuary: ac.newRole({
    ...memberAc.statements,
    product: ["read"],
    rating: ["read", "write", "publish"],
    policy: ["read"],
  }),
  underwriter: ac.newRole({
    ...memberAc.statements,
    product: ["read"],
    submission: ["read", "create", "update"],
    quote: ["read", "bind"],
    uw: ["read", "refer", "approve", "override"],
    policy: ["read", "update"],
    transaction: ["create", "issue"],
  }),
  csr: ac.newRole({
    ...memberAc.statements,
    submission: ["read", "create", "update"],
    quote: ["read"],
    policy: ["read", "update"],
    transaction: ["create"],
    billing: ["read"],
  }),
  agency_admin: ac.newRole({
    ...memberAc.statements,
    submission: ["read", "create", "update"],
    quote: ["read", "bind"],
    policy: ["read"],
    transaction: ["create"],
    agency: ["read", "write"],
  }),
  agent: ac.newRole({
    ...memberAc.statements,
    submission: ["read", "create", "update"],
    quote: ["read", "bind"],
    policy: ["read"],
    transaction: ["create"],
  }),
  customer: ac.newRole({
    submission: ["read", "create", "update"],
    quote: ["read", "bind"],
    policy: ["read"],
  }),
};

export type RoleName = keyof typeof roles;
export type Statements = typeof statements;
export type Permission = { [R in keyof Statements]?: Statements[R][number][] };
