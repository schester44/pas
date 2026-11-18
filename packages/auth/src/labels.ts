import type { RoleName, Statements } from "./permissions";

type Resource = keyof Statements;

export interface ResourceLabel {
  label: string;
  description: string;
  actions: { [A in string]: string };
}

export const resourceLabels: { [R in Resource]: ResourceLabel } = {
  organization: {
    label: "Organization",
    description: "Name, branding and settings.",
    actions: { update: "Edit", delete: "Delete" },
  },
  member: {
    label: "Members",
    description: "Who belongs to the organization and their roles.",
    actions: { create: "Add", update: "Edit", delete: "Remove" },
  },
  invitation: {
    label: "Invitations",
    description: "Invite people by email.",
    actions: { create: "Invite", cancel: "Cancel" },
  },
  team: {
    label: "Teams",
    description: "Groups of members.",
    actions: { create: "Create", update: "Edit", delete: "Delete" },
  },
  ac: {
    label: "Roles",
    description: "Custom roles and their permissions.",
    actions: { read: "View", create: "Create", update: "Edit", delete: "Delete" },
  },
  product: {
    label: "Products",
    description: "Product definitions and versions.",
    actions: { read: "View", write: "Edit", publish: "Publish" },
  },
  decision: {
    label: "Rules",
    description: "Decision tables for eligibility, underwriting and compliance.",
    actions: { read: "View", write: "Edit", publish: "Publish" },
  },
  rating: {
    label: "Rating",
    description: "Rate tables, rating plans and workbooks.",
    actions: { read: "View", write: "Edit", publish: "Publish" },
  },
  document: {
    label: "Documents",
    description: "Templates for policy documents and notices.",
    actions: { read: "View", write: "Edit", publish: "Publish" },
  },
  submission: {
    label: "Submissions",
    description: "New business and renewal submissions.",
    actions: { read: "View", create: "Create", update: "Edit" },
  },
  quote: {
    label: "Quotes",
    description: "Quotes and binding.",
    actions: { read: "View", bind: "Bind" },
  },
  uw: {
    label: "Underwriting",
    description: "Referrals, approvals and overrides.",
    actions: { read: "View", refer: "Refer", approve: "Approve", override: "Override" },
  },
  policy: {
    label: "Policies",
    description: "Policy terms and their details.",
    actions: { read: "View", update: "Edit" },
  },
  transaction: {
    label: "Transactions",
    description: "Endorsements, cancellations and reinstatements.",
    actions: { create: "Create", issue: "Issue", reverse: "Reverse" },
  },
  billing: {
    label: "Billing",
    description: "Invoices, payments and balances.",
    actions: { read: "View", write: "Edit" },
  },
  agency: {
    label: "Agencies",
    description: "Agencies, producers and appointments.",
    actions: { read: "View", write: "Edit" },
  },
  compliance: {
    label: "Compliance",
    description: "Filings, notices and deadlines.",
    actions: { read: "View", write: "Edit" },
  },
};

export const resourceGroups: { label: string; resources: Resource[] }[] = [
  { label: "Organization", resources: ["organization", "member", "invitation", "ac"] },
  { label: "Configuration", resources: ["product", "decision", "rating", "document"] },
  {
    label: "Operations",
    resources: [
      "submission",
      "quote",
      "uw",
      "policy",
      "transaction",
      "billing",
      "agency",
      "compliance",
    ],
  },
];

export const builtInRoleLabels: { [R in RoleName]: { label: string; description: string } } = {
  owner: { label: "Owner", description: "Full access, including deleting the organization." },
  tenant_admin: {
    label: "Admin",
    description: "Full access to configuration, operations and the team.",
  },
  product_manager: {
    label: "Product manager",
    description: "Builds and publishes products, rules, rating and documents.",
  },
  actuary: { label: "Actuary", description: "Owns rating. Reads products and policies." },
  underwriter: {
    label: "Underwriter",
    description: "Works submissions, quotes and referrals; issues transactions.",
  },
  csr: { label: "Customer service", description: "Services policies and starts transactions." },
  agency_admin: {
    label: "Agency admin",
    description: "Runs an agency: its producers, submissions and quotes.",
  },
  agent: { label: "Agent", description: "Submits, quotes and binds business." },
  customer: { label: "Customer", description: "Quotes, binds and views their own policies." },
};

export const builtInRoleOrder: RoleName[] = [
  "owner",
  "tenant_admin",
  "product_manager",
  "actuary",
  "underwriter",
  "csr",
  "agency_admin",
  "agent",
  "customer",
];

export function isBuiltInRole(role: string): role is RoleName {
  return Object.hasOwn(builtInRoleLabels, role);
}

export function roleLabel(role: string): string {
  return role
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      if (isBuiltInRole(name)) return builtInRoleLabels[name].label;

      const words = name.replace(/[_-]+/g, " ").trim();

      return words.charAt(0).toUpperCase() + words.slice(1);
    })
    .join(", ");
}

export function roleKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "")
    .slice(0, 48);
}
