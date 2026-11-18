import { StatusChip } from "@pas/ui/components/status-chip";
import { cn } from "@pas/ui/lib/utils";
import {
  BadgeCheck,
  CreditCard,
  Database,
  Inbox,
  type LucideIcon,
  Mail,
  MapPin,
  Printer,
  Signature,
  Webhook,
} from "lucide-react";

export const CATEGORIES: Record<string, { label: string; port: string }> = {
  payments: {
    label: "Payments",
    port: "Takes card payments at bind and for invoices in the client portal, and refunds cancellations.",
  },
  esign: { label: "E-signature", port: "Signs applications before bind." },
  email: { label: "Email", port: "Sends sign-in codes, portal invitations and notices." },
  sms: { label: "SMS", port: "Sends text messages." },
  print_mail: {
    label: "Print and mail",
    port: "Prints and mails notices, and records proof of mailing.",
  },
  data: {
    label: "Data providers",
    port: "Enable several; choose which one supplies each kind of data in each product's enrichment plan.",
  },
  filing: { label: "Filing", port: "Files surplus lines and regulatory reports." },
  carrier: { label: "Carriers", port: "Exchanges policies with carriers." },
  billing: { label: "Billing", port: "Runs billing in an outside system." },
  llm: { label: "Language models", port: "Powers AI drafting." },
};

export function categoryLabel(category: string): string {
  return CATEGORIES[category]?.label ?? category;
}

const ICONS: Record<string, LucideIcon> = {
  card: CreditCard,
  signature: Signature,
  inbox: Inbox,
  printer: Printer,
  database: Database,
  map: MapPin,
  webhook: Webhook,
  mail: Mail,
};

/** A neutral tile: the vendor's initial, or an icon for generic and built-in providers. */
export function ProviderLogo({
  logo,
  size = "md",
}: {
  logo: { mark?: string; icon?: string };
  size?: "md" | "lg";
}) {
  const Icon = logo.icon ? ICONS[logo.icon] : undefined;

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-lg bg-muted font-semibold tracking-tight text-foreground ring-1 ring-border",
        size === "lg" ? "size-12 text-base [&_svg]:size-5" : "size-10 text-sm [&_svg]:size-[18px]",
      )}
    >
      {Icon ? <Icon /> : logo.mark}
    </span>
  );
}

/** The vendor line under a name, only when it says something the name doesn't. */
export function providerByline(integration: { name: string; vendor: string; builtin: boolean }) {
  if (integration.builtin) return "Built in";

  return integration.vendor === integration.name ? null : integration.vendor;
}

export function CertifiedMark() {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <BadgeCheck className="size-3.5" />
      Certified
    </span>
  );
}

export function InstallState({
  integration,
}: {
  integration: {
    builtin: boolean;
    powering: boolean;
    install: { status: string } | null;
  };
}) {
  if (integration.install?.status === "error") return <StatusChip tone="danger">Error</StatusChip>;

  if (integration.powering) return <StatusChip tone="success">Active</StatusChip>;

  if (integration.install) return <StatusChip>Installed</StatusChip>;

  return <span className="text-xs text-muted-foreground">Available</span>;
}
