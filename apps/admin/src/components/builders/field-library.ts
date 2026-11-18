import type { SchemaNode } from "@pas/forms-core";

export interface LibraryPreset {
  id: string;
  label: string;
  description: string;
  node: SchemaNode;
}

export const FIELD_LIBRARY: readonly LibraryPreset[] = [
  {
    id: "person-name",
    label: "Person name",
    description: "First, middle and last name, and date of birth.",
    node: {
      key: "person",
      kind: "group",
      label: "Person",
      children: [
        { key: "firstName", kind: "text", label: "First name", pii: true },
        { key: "middleName", kind: "text", label: "Middle name", pii: true },
        { key: "lastName", kind: "text", label: "Last name", pii: true },
        { key: "birthDate", kind: "date", label: "Date of birth", pii: true },
      ],
    },
  },
  {
    id: "contact",
    label: "Contact details",
    description: "Email, phone and preferred way to reach them.",
    node: {
      key: "contact",
      kind: "group",
      label: "Contact details",
      children: [
        { key: "email", kind: "email", label: "Email", pii: true, endorsable: true },
        { key: "phone", kind: "phone", label: "Phone", pii: true, endorsable: true },
        {
          key: "preferredChannel",
          kind: "enum",
          label: "Preferred contact method",
          endorsable: true,
          options: [
            { value: "email", label: "Email" },
            { value: "phone", label: "Phone" },
            { value: "mail", label: "Mail" },
          ],
        },
      ],
    },
  },
  {
    id: "address",
    label: "Address",
    description: "A single structured postal address.",
    node: { key: "address", kind: "address", label: "Address", pii: true, endorsable: true },
  },
  {
    id: "prior-insurance",
    label: "Prior insurance",
    description: "Current or most recent policy and any lapse in cover.",
    node: {
      key: "priorInsurance",
      kind: "group",
      label: "Prior insurance",
      children: [
        { key: "hasPriorInsurance", kind: "boolean", label: "Currently insured" },
        { key: "carrierName", kind: "text", label: "Current insurer" },
        { key: "policyNumber", kind: "text", label: "Policy number" },
        { key: "expirationDate", kind: "date", label: "Expiration date" },
        { key: "yearsInsured", kind: "integer", label: "Years continuously insured" },
        { key: "lapseInCoverage", kind: "boolean", label: "Lapse in cover in the last 3 years" },
      ],
    },
  },
  {
    id: "loss-history",
    label: "Loss history",
    description: "A list of prior losses with date, cause and amount paid.",
    node: {
      key: "losses",
      kind: "repeatable",
      label: "Prior losses",
      maxItems: 10,
      children: [
        { key: "lossDate", kind: "date", label: "Date of loss" },
        {
          key: "cause",
          kind: "enum",
          label: "Cause of loss",
          options: [
            { value: "fire", label: "Fire or smoke" },
            { value: "water", label: "Water damage" },
            { value: "wind_hail", label: "Wind or hail" },
            { value: "theft", label: "Theft" },
            { value: "liability", label: "Liability" },
            { value: "other", label: "Other" },
          ],
        },
        { key: "amountPaid", kind: "money", label: "Amount paid" },
        {
          key: "status",
          kind: "enum",
          label: "Claim status",
          options: [
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" },
          ],
        },
        { key: "description", kind: "text", label: "What happened" },
      ],
    },
  },
  {
    id: "dwelling-location",
    label: "Dwelling location",
    description: "A location exposure with address, occupancy and construction.",
    node: {
      key: "locations",
      kind: "repeatable",
      label: "Locations",
      exposure: "location",
      minItems: 1,
      children: [
        { key: "address", kind: "address", label: "Property address" },
        {
          key: "occupancy",
          kind: "enum",
          label: "Occupancy",
          options: [
            { value: "owner", label: "Owner occupied" },
            { value: "tenant", label: "Rented to others" },
            { value: "seasonal", label: "Seasonal" },
            { value: "vacant", label: "Vacant" },
          ],
        },
        { key: "yearBuilt", kind: "integer", label: "Year built" },
        {
          key: "construction",
          kind: "enum",
          label: "Construction",
          options: [
            { value: "frame", label: "Frame" },
            { value: "masonry_veneer", label: "Masonry veneer" },
            { value: "masonry", label: "Masonry" },
            { value: "fire_resistive", label: "Fire resistive" },
          ],
        },
        {
          key: "squareFeet",
          kind: "integer",
          label: "Living area",
          description: "In square feet.",
        },
        { key: "roofYear", kind: "integer", label: "Roof year" },
        { key: "dwellingLimit", kind: "money", label: "Dwelling limit" },
      ],
    },
  },
];
