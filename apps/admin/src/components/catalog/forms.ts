import type { VersionForm } from "./version-editor";

export const CHANNELS = [
  { value: "agent", label: "Agent" },
  { value: "customer", label: "Customer" },
  { value: "internal", label: "Internal" },
] as const;

export const STAGES = [
  { value: "quote", label: "Quote" },
  { value: "bind", label: "Bind" },
  { value: "endorsement", label: "Endorsement" },
] as const;

export const channelLabel = (value: string) =>
  CHANNELS.find((c) => c.value === value)?.label ?? value;
export const stageLabel = (value: string) => STAGES.find((s) => s.value === value)?.label ?? value;

export const formKey = (form: Pick<VersionForm, "channel" | "stage">) =>
  `${form.channel}.${form.stage}`;

export function formTitle(entry: VersionForm): string {
  return (
    entry.form.title || `${channelLabel(entry.channel)} ${stageLabel(entry.stage).toLowerCase()}`
  );
}
