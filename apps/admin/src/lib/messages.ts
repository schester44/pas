import { fillMessage, type Message, type MessageParam } from "@pas/kernel";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { formatMoney, formatPlainDate } from "./format";

type CoverageNames = readonly { code: string; name: string }[];

function formatParam(param: MessageParam, coverages: CoverageNames): string {
  switch (param.kind) {
    case "jurisdiction": {
      const [country = param.code] = param.code.split("-");

      return jurisdictionName(
        param.code.includes("-") ? { country, subdivision: param.code } : { country },
      );
    }
    case "coverage":
      return coverages.find((coverage) => coverage.code === param.code)?.name || param.code;
    case "date":
      return formatPlainDate(param.value);
    case "money":
      return formatMoney(param);
    case "text":
      return param.value;
  }
}

export function formatMessage(message: Message, coverages: CoverageNames = []): string {
  return fillMessage(message.message, message.params, (param) => formatParam(param, coverages));
}
