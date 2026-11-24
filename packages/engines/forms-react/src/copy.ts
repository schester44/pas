export interface Copy {
  back: string;
  next: string;
  submit: string;
  optional: string;
  yes: string;
  no: string;
  choose: string;
  loadingOptions: string;
  optionsUnavailable: string;
  add: (noun: string) => string;
  remove: string;
  entry: (noun: string, position: number) => string;
  empty: (noun: string) => string;
  step: (position: number, total: number) => string;
  address: Record<"line1" | "line2" | "city" | "region" | "postalCode" | "country", string>;
}

export const defaultCopy: Copy = {
  back: "Back",
  next: "Continue",
  submit: "Submit",
  optional: "Optional",
  yes: "Yes",
  no: "No",
  choose: "Choose…",
  loadingOptions: "Loading options…",
  optionsUnavailable: "Options aren't available right now",
  add: (noun) => `Add ${noun.toLowerCase()}`,
  remove: "Remove",
  entry: (noun, position) => `${noun} ${position}`,
  empty: (noun) => `No ${noun.toLowerCase()} added yet.`,
  step: (position, total) => `Step ${position} of ${total}`,
  address: {
    line1: "Street address",
    line2: "Apt, suite or unit",
    city: "City",
    region: "State or region",
    postalCode: "Postal code",
    country: "Country",
  },
};
