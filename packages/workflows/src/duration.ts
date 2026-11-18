import type { WorkflowDuration } from "@pas/kernel";

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  second: 1_000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
};

const PART = /(\d+(?:\.\d+)?)\s*([a-z]+?)s?(?=\d|\s|$)/g;

export function durationToMilliseconds(duration: WorkflowDuration): number {
  if (typeof duration !== "string") {
    const { days = 0, hours = 0, minutes = 0, seconds = 0 } = duration;

    return ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1_000;
  }

  const text = duration.trim().toLowerCase();
  let total = 0;
  let matched = "";

  for (const [part, amount, unit] of text.matchAll(PART)) {
    const ms = unit ? UNIT_MS[unit] : undefined;

    if (ms === undefined) throw new Error(`Unknown duration unit in "${duration}"`);

    total += Number(amount) * ms;
    matched += part;
  }

  if (matched.replace(/\s/g, "") !== text.replace(/\s/g, "")) {
    throw new Error(`Invalid duration "${duration}"`);
  }

  return total;
}
