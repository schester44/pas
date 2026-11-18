import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { formatPlainDate } from "./format";

const JURISDICTION = /\b([A-Z]{2})-([A-Z0-9]{1,3})\b/g;
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/g;

/** Server check messages carry codes and ISO dates; people read names and formatted dates. */
export function readable(
  message: string,
  coverages: readonly { code: string; name: string }[] = [],
) {
  let text = message
    .replace(JURISDICTION, (code, country: string) => {
      const name = jurisdictionName({ country, subdivision: code });

      return name === code ? code : name;
    })
    .replace(ISO_DATE, (date: string) => formatPlainDate(date));

  for (const coverage of coverages) {
    if (coverage.name && coverage.code.includes("_")) {
      text = text.replace(new RegExp(`\\b${coverage.code}\\b`, "g"), coverage.name.toLowerCase());
    }
  }

  return text;
}
