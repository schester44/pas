import { AddressField, defaultCopy } from "@pas/forms-react";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { jurisdictionName, subdivisionsOf } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";
import type { Quote, Requirement } from "@/lib/quotes";
import { useTRPC } from "@/lib/trpc";
import { formatDateTime } from "@/lib/format";
import { insuredOwns, useCompletion } from "./client-completion";
import type { StepProps } from "./journey";
import { PremiumSummary } from "./premium";

type Details = Quote["details"];
type Address = NonNullable<Details["mailingAddress"]>;
type Interest = Details["additionalInterests"][number];
type Declination = Details["declinations"][number];

const INTEREST_LABELS: Record<Interest["kind"], string> = {
  mortgagee: "Mortgagee",
  additional_insured: "Additional insured",
  loss_payee: "Loss payee",
};

const homeStateFrom = (address: Address | null | undefined) =>
  address?.region ? `${address.country || "US"}-${address.region.toUpperCase()}` : "";

const EMPTY_ADDRESS: Address = { line1: "", city: "", region: "", postalCode: "", country: "US" };
const EMPTY_DECLINATION: Declination = { carrier: "", declinedOn: "", reason: "" };
const blank = (value: string | undefined) => !value?.trim();

const declinationComplete = (d: Declination) =>
  !blank(d.carrier) && /^\d{4}-\d{2}-\d{2}$/.test(d.declinedOn) && !blank(d.reason);

const declinationEmpty = (d: Declination) =>
  blank(d.carrier) && blank(d.declinedOn) && blank(d.reason);

export function DetailsStep({ quote, submission, go }: StepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const search = quote.requirements.find((r) => r.kind === "diligent_search");
  const completion = useCompletion(submission.id);
  const clientDiscloses = insuredOwns(completion, "disclosures");
  const offered = quote.requirements.filter((r) => r.kind === "attestation");
  const attestations = clientDiscloses ? [] : offered;
  const [details, setDetails] = useState<Details>(() => withDeclinationRows(quote.details, search));

  const [accepted, setAccepted] = useState(
    () => new Set(quote.details.acknowledgements.map((a) => a.code)),
  );

  const [attempted, setAttempted] = useState(false);
  const save = useMutation(trpc.quotes.saveDetails.mutationOptions());
  const errors = attempted ? validate(details, accepted, attestations, search) : {};
  const set = (patch: Partial<Details>) => setDetails((d) => ({ ...d, ...patch }));

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setAttempted(true);

    if (Object.keys(validate(details, accepted, attestations, search)).length > 0) return;

    save.mutate(
      {
        submissionId: submission.id,
        details: {
          ...details,
          producer: {
            name: details.producer.name,
            ...(details.producer.agency?.trim() && { agency: details.producer.agency.trim() }),
            ...(details.producer.licenseNumber?.trim() && {
              licenseNumber: details.producer.licenseNumber.trim(),
            }),
          },
          additionalInterests: details.additionalInterests.map((interest) => ({
            ...interest,
            address: interest.address?.line1?.trim() ? interest.address : null,
          })),
          declinations: details.declinations.filter((d) => !declinationEmpty(d)),
          acknowledgements: [...accepted],
        },
      },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(
            trpc.quotes.get.queryKey({ submissionId: submission.id }),
            updated,
          );

          go("review");
        },
      },
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="grid gap-6">
        <Panel title="Named insured" description="Who the policy covers. Up to four names.">
          <div className="grid gap-3">
            {details.namedInsureds.map((name, index) => (
              <div key={index} className="flex items-start gap-2">
                <Field
                  label={index === 0 ? "Primary named insured" : `Additional named insured`}
                  error={errors[`name.${index}`]}
                  className="flex-1"
                >
                  {(id) => (
                    <Input
                      id={id}
                      value={name}
                      autoComplete="name"
                      onChange={(e) =>
                        set({
                          namedInsureds: details.namedInsureds.map((n, i) =>
                            i === index ? e.target.value : n,
                          ),
                        })
                      }
                    />
                  )}
                </Field>
                {index > 0 && (
                  <RemoveButton
                    label="Remove named insured"
                    onClick={() =>
                      set({ namedInsureds: details.namedInsureds.filter((_, i) => i !== index) })
                    }
                  />
                )}
              </div>
            ))}
            {details.namedInsureds.length < 4 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => set({ namedInsureds: [...details.namedInsureds, ""] })}
              >
                <Plus /> Add a named insured
              </Button>
            )}
          </div>
        </Panel>

        <Panel title="Mailing address" description="Where we send the policy and notices.">
          <AddressFields
            value={details.mailingAddress ?? EMPTY_ADDRESS}
            onChange={(mailingAddress) => set({ mailingAddress })}
            errors={errors}
          />
        </Panel>

        {search && (
          <Panel
            title="Home state"
            description="The insured's principal residence or place of business. It decides which state's surplus lines filing and taxes apply."
          >
            <Field label="Home state">
              {(id) => (
                <Select
                  value={details.homeState ?? homeStateFrom(details.mailingAddress)}
                  onValueChange={(homeState) => set({ homeState })}
                >
                  <SelectTrigger id={id} className="sm:max-w-xs">
                    <SelectValue placeholder="Same as the mailing address" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {subdivisionsOf("US").map(([code, name]) => (
                      <SelectItem key={code} value={code}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </Panel>
        )}

        <Panel title="Producer">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Producer name" error={errors["producer.name"]}>
              {(id) => (
                <Input
                  id={id}
                  value={details.producer.name}
                  onChange={(e) => set({ producer: { ...details.producer, name: e.target.value } })}
                />
              )}
            </Field>
            <Field label="Agency" optional>
              {(id) => (
                <Input
                  id={id}
                  value={details.producer.agency ?? ""}
                  onChange={(e) =>
                    set({ producer: { ...details.producer, agency: e.target.value } })
                  }
                />
              )}
            </Field>
            <Field label="License number" optional>
              {(id) => (
                <Input
                  id={id}
                  value={details.producer.licenseNumber ?? ""}
                  className="tabular-nums"
                  onChange={(e) =>
                    set({ producer: { ...details.producer, licenseNumber: e.target.value } })
                  }
                />
              )}
            </Field>
          </div>
        </Panel>

        <Panel
          title="Additional interests"
          description="Mortgagees, additional insureds and loss payees who get a copy of the policy."
          flush
        >
          {details.additionalInterests.length > 0 && (
            <ul className="m-0 list-none divide-y border-b p-0">
              {details.additionalInterests.map((interest, index) => (
                <li
                  key={index}
                  className="grid items-start gap-3 px-(--card-p) py-4 sm:grid-cols-[11rem_minmax(0,1fr)_12rem_auto]"
                >
                  <Field label="Type">
                    {(id) => (
                      <Select
                        value={interest.kind}
                        onValueChange={(kind) =>
                          updateInterest(index, { kind: kind as Interest["kind"] })
                        }
                      >
                        <SelectTrigger id={id}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(INTEREST_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                  <Field label="Name" error={errors[`interest.${index}`]}>
                    {(id) => (
                      <Input
                        id={id}
                        value={interest.name}
                        onChange={(e) => updateInterest(index, { name: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Loan number" optional>
                    {(id) => (
                      <Input
                        id={id}
                        value={interest.reference ?? ""}
                        className="tabular-nums"
                        onChange={(e) => updateInterest(index, { reference: e.target.value })}
                      />
                    )}
                  </Field>
                  <RemoveButton
                    label="Remove interest"
                    className="sm:mt-6"
                    onClick={() =>
                      set({
                        additionalInterests: details.additionalInterests.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  />
                  {interest.kind === "mortgagee" && (
                    <div className="grid gap-3 sm:col-span-4 sm:grid-cols-[minmax(0,1fr)_16rem]">
                      <Field label="Lender mailing address" optional>
                        {() => (
                          <AddressFields
                            value={interest.address ?? EMPTY_ADDRESS}
                            onChange={(address) => updateInterest(index, { address })}
                            errors={{}}
                          />
                        )}
                      </Field>
                      <Field label="Lender email" optional>
                        {(id) => (
                          <Input
                            id={id}
                            type="email"
                            value={interest.email ?? ""}
                            onChange={(e) =>
                              updateInterest(index, { email: e.target.value || undefined })
                            }
                          />
                        )}
                      </Field>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="px-(--card-p) py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                set({
                  additionalInterests: [
                    ...details.additionalInterests,
                    { kind: "mortgagee", name: "", address: null },
                  ],
                })
              }
            >
              <Plus /> Add an interest
            </Button>
          </div>
        </Panel>

        {search && (
          <Panel
            title="Diligent search affidavit"
            description={searchDescription(search, jurisdictionName(submission.jurisdiction))}
            flush
          >
            <ol className="m-0 list-none divide-y p-0">
              {details.declinations.map((declination, index) => (
                <li
                  key={index}
                  className={cn(
                    "grid items-start gap-3 px-(--card-p) py-4 sm:grid-cols-[1.5rem_minmax(0,1fr)_10rem_minmax(0,1fr)]",
                    errors[`declination.${index}`] && "[&_input]:border-destructive",
                  )}
                >
                  <span className="hidden pt-8 text-sm text-muted-foreground tabular-nums sm:block">
                    {index + 1}
                  </span>
                  <Field label="Admitted carrier">
                    {(id) => (
                      <Input
                        id={id}
                        value={declination.carrier}
                        onChange={(e) => updateDeclination(index, { carrier: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Declined on">
                    {(id) => (
                      <Input
                        id={id}
                        type="date"
                        value={declination.declinedOn}
                        className="tabular-nums"
                        onChange={(e) => updateDeclination(index, { declinedOn: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Reason">
                    {(id) => (
                      <Input
                        id={id}
                        value={declination.reason}
                        onChange={(e) => updateDeclination(index, { reason: e.target.value })}
                      />
                    )}
                  </Field>
                  {errors[`declination.${index}`] && (
                    <p className="m-0 text-sm text-destructive sm:col-span-3 sm:col-start-2">
                      {errors[`declination.${index}`]}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        )}

        {clientDiscloses && offered.length > 0 && (
          <Panel
            title="Disclosures"
            description="The insured accepts these from the link you send them on the next step."
          >
            <ul className="m-0 grid list-none gap-4 p-0">
              {offered.map((attestation) => {
                const code = attestation.id.replace(/^attestation:/, "");
                const ack = quote.details.acknowledgements.find((a) => a.code === code);

                return (
                  <li key={code} className="grid gap-1 rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm leading-5 font-medium">{attestation.title}</span>
                      <span
                        className={cn(
                          "shrink-0 text-xs tabular-nums",
                          ack ? "text-emerald-700" : "text-muted-foreground",
                        )}
                      >
                        {ack
                          ? `Accepted${ack.by ? ` by ${ack.by.name}` : ""}, ${formatDateTime(ack.acceptedAt)}`
                          : "Waiting for the insured"}
                      </span>
                    </div>
                    <p className="m-0 text-sm text-muted-foreground">{attestation.statement}</p>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}

        {attestations.length > 0 && (
          <Panel
            title="Disclosures"
            description="The insured confirms each of these before signing."
          >
            <ul className="m-0 grid list-none gap-4 p-0">
              {attestations.map((attestation) => {
                const code = attestation.id.replace(/^attestation:/, "");
                const id = `ack-${code}`;
                const error = errors[`ack.${code}`];

                return (
                  <li
                    key={code}
                    className={cn("rounded-lg border p-4", error && "border-destructive/50")}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={id}
                        checked={accepted.has(code)}
                        aria-invalid={!!error || undefined}
                        onCheckedChange={(on) =>
                          setAccepted((current) => {
                            const next = new Set(current);

                            if (on === true) next.add(code);
                            else next.delete(code);

                            return next;
                          })
                        }
                        className="mt-0.5"
                      />
                      <div className="grid gap-1">
                        <Label htmlFor={id} className="leading-5">
                          {attestation.title}
                        </Label>
                        <p className="m-0 text-sm text-muted-foreground">{attestation.statement}</p>
                        {error && <p className="m-0 text-sm text-destructive">{error}</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}

        {save.error && (
          <Notice tone="error" title="Couldn't save the details">
            {save.error.message}
          </Notice>
        )}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => go("customize")}>
            Back
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            Continue to review
          </Button>
        </div>
      </div>
      <PremiumSummary quote={quote} />
    </form>
  );

  function updateInterest(index: number, patch: Partial<Interest>) {
    set({
      additionalInterests: details.additionalInterests.map((interest, i) =>
        i === index ? { ...interest, ...patch } : interest,
      ),
    });
  }

  function updateDeclination(index: number, patch: Partial<Declination>) {
    set({
      declinations: details.declinations.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    });
  }
}

function withDeclinationRows(details: Details, search: Requirement | undefined): Details {
  const needed = search?.declinationsRequired ?? 0;
  const rows = [...details.declinations];

  while (rows.length < needed) rows.push({ ...EMPTY_DECLINATION });

  return { ...details, declinations: rows };
}

function searchDescription(search: Requirement, state: string) {
  const count = `${search.declinationsRequired} declinations from admitted carriers`;

  return search.blocking
    ? `${state} requires ${count} before binding.`
    : `${state} requires ${count}, due after binding. Add them now or later.`;
}

function validate(
  details: Details,
  accepted: Set<string>,
  attestations: Requirement[],
  search: Requirement | undefined,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const address = details.mailingAddress ?? EMPTY_ADDRESS;

  if (blank(details.namedInsureds[0])) errors["name.0"] = "Enter the named insured";

  details.namedInsureds.forEach((name, index) => {
    if (index > 0 && blank(name)) errors[`name.${index}`] = "Enter a name or remove this row";
  });

  if (blank(address.line1)) errors["address.line1"] = "Enter a street address";

  if (blank(address.city)) errors["address.city"] = "Enter a city";

  if (blank(address.region)) errors["address.region"] = "Choose a state";

  if (!/^\d{5}(-\d{4})?$/.test(address.postalCode.trim())) {
    errors["address.postalCode"] = "Enter a 5-digit ZIP code";
  }

  if (blank(details.producer.name)) errors["producer.name"] = "Enter the producer";

  details.additionalInterests.forEach((interest, index) => {
    if (blank(interest.name)) errors[`interest.${index}`] = "Enter a name or remove this interest";
  });

  details.declinations.forEach((declination, index) => {
    const optional = !search?.blocking && declinationEmpty(declination);

    if (!optional && !declinationComplete(declination)) {
      errors[`declination.${index}`] = "Enter the carrier, date and reason";
    }
  });

  for (const attestation of attestations) {
    const code = attestation.id.replace(/^attestation:/, "");

    if (!accepted.has(code)) errors[`ack.${code}`] = "The insured needs to accept this";
  }

  return errors;
}

function AddressFields({
  value,
  onChange,
  errors,
}: {
  value: Address;
  onChange: (value: Address) => void;
  errors: Record<string, string>;
}) {
  const id = useId();

  const error = ["address.line1", "address.city", "address.region", "address.postalCode"]
    .map((key) => errors[key])
    .find(Boolean);

  return (
    <div className="grid gap-2">
      <AddressField
        id={id}
        value={value}
        onChange={(next) => onChange(next ?? EMPTY_ADDRESS)}
        country="US"
        invalid={Boolean(error)}
        describedBy={error ? `${id}-error` : undefined}
        copy={{
          ...defaultCopy.address,
          line2: "Apt, suite",
          region: "State",
          postalCode: "ZIP code",
        }}
      />
      {error && (
        <p id={`${id}-error`} className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  optional,
  error,
  className,
  children,
}: {
  label: string;
  optional?: boolean;
  error?: string;
  className?: string;
  children: (id: string) => React.ReactElement;
}) {
  const id = useId();

  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">optional</span>}
      </Label>
      <div
        className={cn(
          "grid",
          error && "[&_button]:border-destructive [&_input]:border-destructive",
        )}
      >
        {children(id)}
      </div>
      {error && <p className="m-0 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function RemoveButton({
  label,
  onClick,
  className,
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onClick}
      className={cn("mt-6 text-muted-foreground", className)}
    >
      <X />
    </Button>
  );
}
