import { evaluateForm, type FormDefinition, type RiskSchema } from "@pas/forms-core";
import { type FormData, IntakeForm, useExpressionsReady } from "@pas/forms-react";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authed/playground/forms")({
  component: FormsPlayground,
});

const schema: RiskSchema = {
  fields: [
    {
      key: "insured",
      kind: "group",
      label: "Named insured",
      children: [
        { key: "firstName", kind: "text", label: "First name", pii: true },
        { key: "lastName", kind: "text", label: "Last name", pii: true },
        { key: "birthDate", kind: "date", label: "Date of birth", pii: true },
        { key: "email", kind: "email", label: "Email", pii: true, endorsable: true },
        { key: "phone", kind: "phone", label: "Phone", pii: true, endorsable: true },
      ],
    },
    { key: "mailingAddress", kind: "address", label: "Mailing address", pii: true, country: "US" },
    { key: "effectiveDate", kind: "date", label: "Policy start date" },
    {
      key: "locations",
      kind: "repeatable",
      label: "Locations",
      exposure: "location",
      minItems: 1,
      maxItems: 5,
      children: [
        { key: "address", kind: "address", label: "Property address", country: "US" },
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
        { key: "roofAge", kind: "integer", label: "Roof age", description: "In years." },
        { key: "roofInspected", kind: "boolean", label: "Roof inspected in the last 3 years" },
        { key: "protectionClass", kind: "integer", label: "Protection class" },
        { key: "dwellingLimit", kind: "money", label: "Dwelling limit", currency: "USD" },
      ],
    },
    { key: "priorClaims", kind: "integer", label: "Claims in the last 5 years" },
    { key: "claimsDescription", kind: "text", label: "Describe the claims" },
  ],
};

const form: FormDefinition = {
  key: "homeowners-quote",
  title: "Homeowners quote",
  steps: [
    {
      id: "applicant",
      title: "Applicant",
      sections: [
        {
          id: "insured",
          title: "Named insured",
          items: [
            { path: "insured.firstName", required: true },
            { path: "insured.lastName", required: true },
            { path: "insured.birthDate", required: true },
            { path: "effectiveDate", required: true },
            { path: "insured.email", required: true },
            { path: "insured.phone" },
            {
              path: "mailingAddress",
              required: true,
              help: "Where we send policy documents.",
            },
          ],
        },
      ],
    },
    {
      id: "property",
      title: "Property",
      sections: [
        {
          id: "locations",
          repeat: "locations",
          itemLabel: "Location",
          description: "Each insured dwelling, up to five.",
          items: [
            { path: "address", required: true },
            {
              path: "yearBuilt",
              required: true,
              validations: [
                { expression: "$item.yearBuilt >= 1800", message: "Enter a year from 1800 on" },
              ],
            },
            { path: "construction", required: true },
            {
              path: "roofAge",
              required: true,
              validations: [{ expression: "$item.roofAge >= 0", message: "Enter 0 or more" }],
            },
            {
              path: "roofInspected",
              visibleWhen: "$item.roofAge > 20",
              required: true,
            },
            {
              path: "protectionClass",
              required: true,
              help: "1 to 10, from the local fire protection rating.",
              validations: [
                {
                  expression: "$item.protectionClass >= 1 and $item.protectionClass <= 10",
                  message: "Enter a class from 1 to 10",
                },
              ],
            },
            { path: "dwellingLimit", required: true },
          ],
        },
      ],
    },
    {
      id: "history",
      title: "Loss history",
      sections: [
        {
          id: "claims",
          title: "Prior claims",
          items: [
            {
              path: "priorClaims",
              required: true,
              validations: [{ expression: "priorClaims >= 0", message: "Enter 0 or more" }],
            },
            {
              path: "claimsDescription",
              widget: "textarea",
              visibleWhen: "priorClaims > 0",
              required: true,
              help: "Dates, causes and amounts paid.",
            },
          ],
        },
      ],
    },
  ],
};

const initial: FormData = { locations: [{}] };

function FormsPlayground() {
  const [value, setValue] = useState<FormData>(initial);
  const [submitted, setSubmitted] = useState<FormData>();
  const ready = useExpressionsReady();

  const state = useMemo(
    () => (ready ? evaluateForm(schema, form, value) : undefined),
    [ready, value],
  );

  const items = state
    ? Object.fromEntries(
        Object.entries(state.items).map(([path, item]) => [
          path,
          { visible: item.visible, required: item.required, errors: item.errors },
        ]),
      )
    : {};

  return (
    <>
      <PageHeader title="Questions playground" />
      <PageBody className="max-w-6xl">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-6">
            {submitted && (
              <Notice title="Submission accepted">
                The server would store the data on the right.
              </Notice>
            )}
            <IntakeForm
              schema={schema}
              form={form}
              value={value}
              onChange={(next) => {
                setValue(next);
                setSubmitted(undefined);
              }}
              onSubmit={setSubmitted}
            />
          </div>
          <div className="grid gap-6 lg:sticky lg:top-20">
            <Panel
              flush
              title={submitted ? "Submitted data" : "Evaluated state"}
              description={
                submitted
                  ? "Coerced values, hidden fields dropped."
                  : state?.valid
                    ? "Every visible field is valid."
                    : undefined
              }
            >
              <pre className="m-0 max-h-[60vh] overflow-auto px-(--card-p) py-4 font-mono text-xs leading-5">
                {JSON.stringify(submitted ?? { valid: state?.valid, items }, null, 2)}
              </pre>
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}
