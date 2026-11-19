export type MessageParam =
  | { kind: "jurisdiction"; code: string }
  | { kind: "date"; value: string }
  | { kind: "coverage"; code: string }
  | { kind: "money"; amount: string; currency: string }
  | { kind: "text"; value: string };

export type MessageParams = Readonly<Record<string, MessageParam>>;

/** A message whose `{name}` placeholders are filled from `params`, so each client formats them. */
export interface Message {
  message: string;
  params?: MessageParams;
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function fillMessage(
  message: string,
  params: MessageParams | undefined,
  format: (param: MessageParam) => string,
): string {
  if (!params) return message;

  return message.replace(PLACEHOLDER, (token, name: string) => {
    const param = params[name];

    return param ? format(param) : token;
  });
}

function rawParam(param: MessageParam): string {
  switch (param.kind) {
    case "jurisdiction":
    case "coverage":
      return param.code;
    case "date":
    case "text":
      return param.value;
    case "money":
      return `${param.amount} ${param.currency}`;
  }
}

export const plainMessage = ({ message, params }: Message) =>
  fillMessage(message, params, rawParam);
