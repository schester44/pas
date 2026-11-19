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
    invitation: ["create"],
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

/** Roles that sell (agencies and their producers); everything else built in is tenant staff. */
export const DISTRIBUTION_ROLES: readonly string[] = ["agency_admin", "agent"];

const AGENCY_ROLES: ReadonlySet<string> = new Set(["agency_admin"]);
const OWN_BOOK_ROLES: ReadonlySet<string> = new Set(["agent", "customer"]);

export type BookReach = "tenant" | "agency" | "own";

/**
 * ABAC on top of RBAC (PLAN §5.7): staff roles reach the tenant's whole book, agency admins their
 * agencies and sub-agencies, and agents, customers and custom roles only their own production.
 * With several roles the widest wins.
 */
export function bookReach(role: string): BookReach {
  const names = role
    .split(",")
    .map((name) => name.trim())
    .filter((name) => Object.hasOwn(roles, name));

  if (names.some((name) => !AGENCY_ROLES.has(name) && !OWN_BOOK_ROLES.has(name))) return "tenant";

  return names.some((name) => AGENCY_ROLES.has(name)) ? "agency" : "own";
}

const ADMIN_ROLES: ReadonlySet<string> = new Set(["owner", "tenant_admin"]);

/**
 * Who a member is to event notifications (PLAN §15.8): staff hear about the whole book,
 * producers only about their own, customers get none. Admins also get operational email.
 */
export function eventAudience(role: string): {
  audience: "staff" | "producer" | null;
  admin: boolean;
} {
  const names = role.split(",").map((name) => name.trim());
  const admin = names.some((name) => ADMIN_ROLES.has(name));

  if (bookReach(role) === "tenant") return { audience: "staff", admin };

  return { audience: names.every((name) => name === "customer") ? null : "producer", admin };
}

export type Statements = typeof statements;
export type Permission = { [R in keyof Statements]?: Statements[R][number][] };

export * from "./labels";
