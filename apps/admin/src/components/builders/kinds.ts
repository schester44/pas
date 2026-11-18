import type { FieldKind, SchemaNode, Widget } from "@pas/forms-core";
import {
  Banknote,
  Calendar,
  CircleDot,
  Folder,
  Hash,
  ListChecks,
  type LucideIcon,
  Mail,
  MapPin,
  Paperclip,
  Percent,
  Phone,
  Rows3,
  ToggleLeft,
  Type,
} from "lucide-react";

type NodeKind = SchemaNode["kind"];

export const KIND_META: Record<NodeKind, { label: string; icon: LucideIcon }> = {
  text: { label: "Text", icon: Type },
  number: { label: "Number", icon: Hash },
  integer: { label: "Whole number", icon: Hash },
  money: { label: "Money", icon: Banknote },
  percent: { label: "Percent", icon: Percent },
  date: { label: "Date", icon: Calendar },
  boolean: { label: "Yes or no", icon: ToggleLeft },
  enum: { label: "Choice", icon: CircleDot },
  multi_enum: { label: "Multiple choice", icon: ListChecks },
  address: { label: "Address", icon: MapPin },
  phone: { label: "Phone", icon: Phone },
  email: { label: "Email", icon: Mail },
  file: { label: "File", icon: Paperclip },
  group: { label: "Group", icon: Folder },
  repeatable: { label: "Repeatable", icon: Rows3 },
};

export const WIDGET_LABELS: Record<Widget, string> = {
  textarea: "Multi-line text",
  select: "Dropdown",
  radio: "Radio buttons",
  checkbox: "Checkbox",
  checkboxes: "Checkboxes",
};

export const hasOptions = (kind: FieldKind) => kind === "enum" || kind === "multi_enum";
