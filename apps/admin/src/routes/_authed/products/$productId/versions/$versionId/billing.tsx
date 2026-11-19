import { Money } from "@pas/kernel";
import { buildSchedule } from "@pas/pay-plans";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { cn } from "@pas/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarClock, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/catalog/confirm-dialog";
import {
  type BillingConfig,
  type PayPlan,
  useVersionEditor,
} from "@/components/catalog/version-editor";
import { formatMoney, formatPlainDate } from "@/lib/format";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/billing")({
  validateSearch: (search: Record<string, unknown>): { plan?: string } =>
    typeof search.plan === "string" ? { plan: search.plan } : {},
  component: BillingTab,
});

const CURRENCY = "USD";
const DECIMAL = /^\d+(\.\d+)?$/;

const newPlan = (index: number): PayPlan => ({
  key: `plan_${index + 1}`,
  label: "",
  installments: 1,
  intervalMonths: 1,
  downPayment: { kind: "first_installment" },
  installmentFee: null,
  taxesFees: "up_front",
  dueDaysBefore: 0,
  billDaysBeforeDue: 14,
  graceDays: 10,
  eligibility: {},
});

function number(value: string, min = 0) {
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? Math.max(min, parsed) : min;
}

const money = (amount: Money) => formatMoney(amount.toJSON());

function downPaymentLabel(plan: PayPlan) {
  if (plan.installments <= 1) return "Pay in full";

  return plan.downPayment.kind === "percent"
    ? `${plan.downPayment.percent}% down`
    : "First installment";
}

function eligibilityLabel(plan: PayPlan) {
  const rules = plan.eligibility;

  const parts = [
    rules.minPremium && `≥ ${formatMoney({ amount: rules.minPremium, currency: CURRENCY })}`,
    rules.jurisdictions?.length && rules.jurisdictions.join(", "),
    rules.channels?.length && rules.channels.join(", "),
    rules.when?.trim() && "Expression",
  ].filter(Boolean);

  const who = parts.length ? parts.join(" · ") : "Everyone";

  return rules.mortgageeBilling ? `${who}, incl. mortgagee billing` : who;
}

function BillingTab() {
  const { contents, readOnly, set } = useVersionEditor();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const billing = contents.billing;
  const plans = billing.payPlans;
  const selected = plans.find((p) => p.key === search.plan) ?? plans[0];

  const save = (next: BillingConfig, immediate?: boolean) => set("billing", next, immediate);
  const select = (plan: string) => navigate({ search: { plan }, replace: true });

  function add() {
    const plan = newPlan(plans.length);

    save(
      { ...billing, payPlans: [...plans, plan], defaultPlan: billing.defaultPlan ?? plan.key },
      true,
    );

    select(plan.key);
  }

  const addAction = !readOnly && (
    <Button size="sm" variant="outline" onClick={add}>
      <Plus /> Add pay plan
    </Button>
  );

  return (
    <PageBody className="max-w-6xl">
      <Panel
        title="Pay plans"
        description="How insureds can pay the premium, and who each plan is offered to."
        action={plans.length > 0 && addAction}
        flush
      >
        {plans.length === 0 ? (
          <EmptyState
            icon={<CalendarClock />}
            title="No pay plans yet"
            description="Without pay plans the full premium is due at bind."
            action={addAction}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plan</TableHead>
                <TableHead>Installments</TableHead>
                <TableHead>Down payment</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Taxes and fees</TableHead>
                <TableHead>Offered to</TableHead>
                <TableHead className="text-right">Default</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow
                  key={plan.key}
                  aria-selected={plan.key === selected?.key}
                  onClick={() => select(plan.key)}
                  className={cn(
                    "cursor-pointer",
                    plan.key === selected?.key ? "bg-primary/5" : "hover:bg-muted/40",
                  )}
                >
                  <TableCell>
                    <div className="grid gap-0.5">
                      <span className={cn("font-medium", !plan.label && "text-muted-foreground")}>
                        {plan.label || "Untitled plan"}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">{plan.key}</span>
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {plan.installments <= 1
                      ? "1"
                      : `${plan.installments}, every ${plan.intervalMonths === 1 ? "month" : `${plan.intervalMonths} months`}`}
                  </TableCell>
                  <TableCell>{downPaymentLabel(plan)}</TableCell>
                  <TableCell className="tabular-nums">
                    {plan.installmentFee && Number(plan.installmentFee) > 0 ? (
                      formatMoney({ amount: plan.installmentFee, currency: CURRENCY })
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </TableCell>
                  <TableCell>{plan.taxesFees === "spread" ? "Spread" : "Up front"}</TableCell>
                  <TableCell className="text-muted-foreground">{eligibilityLabel(plan)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {billing.defaultPlan === plan.key ? "Default" : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      {selected && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
          <PlanEditor
            key={selected.key}
            plan={selected}
            isDefault={billing.defaultPlan === selected.key}
            readOnly={readOnly}
            onChange={(next) => {
              save({
                ...billing,
                payPlans: plans.map((p) => (p.key === selected.key ? next : p)),
                defaultPlan: billing.defaultPlan === selected.key ? next.key : billing.defaultPlan,
              });

              if (next.key !== selected.key) select(next.key);
            }}
            onMakeDefault={() => save({ ...billing, defaultPlan: selected.key }, true)}
            onRemove={() => {
              const rest = plans.filter((p) => p.key !== selected.key);

              save(
                {
                  ...billing,
                  payPlans: rest,
                  defaultPlan:
                    billing.defaultPlan === selected.key
                      ? (rest[0]?.key ?? null)
                      : billing.defaultPlan,
                },
                true,
              );

              navigate({ search: {}, replace: true });
            }}
          />
          <SchedulePreview plan={selected} />
        </div>
      )}

      <Collections billing={billing} readOnly={readOnly} onChange={(next) => save(next)} />
      <BillingMethods billing={billing} readOnly={readOnly} onChange={(next) => save(next)} />
    </PageBody>
  );
}

function PlanEditor({
  plan,
  isDefault,
  readOnly,
  onChange,
  onMakeDefault,
  onRemove,
}: {
  plan: PayPlan;
  isDefault: boolean;
  readOnly: boolean;
  onChange: (next: PayPlan) => void;
  onMakeDefault: () => void;
  onRemove: () => void;
}) {
  const id = useId();
  const [removing, setRemoving] = useState(false);
  const update = (changes: Partial<PayPlan>) => onChange({ ...plan, ...changes });
  const rules = plan.eligibility;

  const eligibility = (changes: Partial<PayPlan["eligibility"]>) =>
    update({ eligibility: { ...rules, ...changes } });

  const installments = plan.installments > 1;

  return (
    <Panel
      title={plan.label || "Untitled plan"}
      action={
        !readOnly && (
          <div className="flex gap-2">
            {!isDefault && (
              <Button variant="outline" size="sm" onClick={onMakeDefault}>
                Make default
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setRemoving(true)}
            >
              Remove
            </Button>
          </div>
        )
      }
    >
      <div className="grid gap-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-label`} label="Name">
            <Input
              id={`${id}-label`}
              value={plan.label}
              disabled={readOnly}
              placeholder="Quarterly"
              onChange={(e) => update({ label: e.target.value })}
            />
          </Field>
          <Field id={`${id}-key`} label="Key">
            <Input
              id={`${id}-key`}
              value={plan.key}
              disabled={readOnly}
              className="font-mono"
              onChange={(e) => update({ key: e.target.value })}
            />
          </Field>
          <Field id={`${id}-installments`} label="Installments">
            <Input
              id={`${id}-installments`}
              type="number"
              min={1}
              value={plan.installments}
              disabled={readOnly}
              className="tabular-nums"
              onChange={(e) => update({ installments: number(e.target.value, 1) })}
            />
          </Field>
          <Field id={`${id}-interval`} label="Months between installments">
            <Input
              id={`${id}-interval`}
              type="number"
              min={1}
              value={plan.intervalMonths}
              disabled={readOnly || !installments}
              className="tabular-nums"
              onChange={(e) => update({ intervalMonths: number(e.target.value, 1) })}
            />
          </Field>
        </div>

        {installments && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-down`} label="Down payment">
              <SegmentedControl
                label="Down payment"
                value={plan.downPayment.kind}
                options={[
                  { value: "first_installment", label: "First installment", disabled: readOnly },
                  { value: "percent", label: "Percent", disabled: readOnly },
                ]}
                onValueChange={(kind) =>
                  update({ downPayment: kind === "percent" ? { kind, percent: "20" } : { kind } })
                }
              />
            </Field>
            {plan.downPayment.kind === "percent" && (
              <Field id={`${id}-percent`} label="Down payment percent">
                <Input
                  id={`${id}-percent`}
                  inputMode="decimal"
                  value={plan.downPayment.percent}
                  disabled={readOnly}
                  className="tabular-nums"
                  onChange={(e) =>
                    update({ downPayment: { kind: "percent", percent: e.target.value } })
                  }
                />
              </Field>
            )}
            <Field id={`${id}-fee`} label="Installment fee" optional>
              <Input
                id={`${id}-fee`}
                inputMode="decimal"
                value={plan.installmentFee ?? ""}
                disabled={readOnly}
                placeholder="0.00"
                className="tabular-nums"
                onChange={(e) => update({ installmentFee: e.target.value || null })}
              />
            </Field>
            <Field id={`${id}-taxes`} label="Taxes and fees">
              <SegmentedControl
                label="Taxes and fees"
                value={plan.taxesFees}
                options={[
                  { value: "up_front", label: "Up front", disabled: readOnly },
                  { value: "spread", label: "Spread", disabled: readOnly },
                ]}
                onValueChange={(taxesFees) => update({ taxesFees })}
              />
            </Field>
            <Field id={`${id}-due`} label="Due days before installment date">
              <Input
                id={`${id}-due`}
                type="number"
                min={0}
                value={plan.dueDaysBefore}
                disabled={readOnly}
                className="tabular-nums"
                onChange={(e) => update({ dueDaysBefore: number(e.target.value) })}
              />
            </Field>
            <Field id={`${id}-bill`} label="Bill days before due">
              <Input
                id={`${id}-bill`}
                type="number"
                min={0}
                value={plan.billDaysBeforeDue}
                disabled={readOnly}
                className="tabular-nums"
                onChange={(e) => update({ billDaysBeforeDue: number(e.target.value) })}
              />
            </Field>
            <Field id={`${id}-grace`} label="Grace days">
              <Input
                id={`${id}-grace`}
                type="number"
                min={0}
                value={plan.graceDays}
                disabled={readOnly}
                className="tabular-nums"
                onChange={(e) => update({ graceDays: number(e.target.value) })}
              />
            </Field>
          </div>
        )}

        <div className="grid gap-4">
          <h3 className="m-0 text-sm leading-5 font-medium">Offered to</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-min`} label="Minimum premium" optional>
              <Input
                id={`${id}-min`}
                inputMode="decimal"
                value={rules.minPremium ?? ""}
                disabled={readOnly}
                placeholder="1000"
                className="tabular-nums"
                onChange={(e) => eligibility({ minPremium: e.target.value || undefined })}
              />
            </Field>
            <Field id={`${id}-states`} label="Jurisdictions" optional>
              <Input
                id={`${id}-states`}
                value={(rules.jurisdictions ?? []).join(", ")}
                disabled={readOnly}
                placeholder="US-IL, US-IN"
                onChange={(e) => {
                  const list = e.target.value
                    .split(",")
                    .map((s) => s.trim().toUpperCase())
                    .filter(Boolean);

                  eligibility({ jurisdictions: list.length ? list : undefined });
                }}
              />
            </Field>
            <Field id={`${id}-when`} label="Only when" optional className="sm:col-span-2">
              <Input
                id={`${id}-when`}
                value={rules.when ?? ""}
                disabled={readOnly}
                placeholder='channel == "agent"'
                className="font-mono"
                onChange={(e) => eligibility({ when: e.target.value || undefined })}
              />
            </Field>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox
                id={`${id}-mortgagee`}
                checked={rules.mortgageeBilling ?? false}
                disabled={readOnly}
                onCheckedChange={(checked) =>
                  eligibility({ mortgageeBilling: checked === true || undefined })
                }
              />
              <Label htmlFor={`${id}-mortgagee`} className="font-normal">
                Offer when the mortgagee pays
              </Label>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={`Remove ${plan.label || "this plan"}?`}
        description="Quotes on this version won't offer it any more."
        confirmLabel="Remove plan"
        onConfirm={onRemove}
      />
    </Panel>
  );
}

function SchedulePreview({ plan }: { plan: PayPlan }) {
  const id = useId();
  const [premium, setPremium] = useState("1200.00");
  const [taxes, setTaxes] = useState("48.00");

  const schedule = useMemo(() => {
    if (!DECIMAL.test(premium) || !DECIMAL.test(taxes || "0")) return null;

    try {
      return buildSchedule(plan, {
        premium: Money.of(premium, CURRENCY),
        taxesFees:
          Number(taxes) > 0
            ? [{ code: "TAX", label: "Taxes and fees", amount: Money.of(taxes, CURRENCY) }]
            : [],
        effectiveDate: Temporal.Now.plainDateISO(),
        billedOn: Temporal.Now.plainDateISO(),
        rounding: { places: 2, mode: "half_up" },
      });
    } catch {
      return null;
    }
  }, [plan, premium, taxes]);

  const total = schedule?.reduce((sum, i) => sum.plus(i.total), Money.zero(CURRENCY));

  return (
    <Panel title="Schedule preview" description="For a policy effective today." flush>
      <div className="grid grid-cols-2 gap-4 border-b p-(--card-p)">
        <Field id={`${id}-premium`} label="Premium">
          <Input
            id={`${id}-premium`}
            inputMode="decimal"
            value={premium}
            className="tabular-nums"
            onChange={(e) => setPremium(e.target.value)}
          />
        </Field>
        <Field id={`${id}-taxes`} label="Taxes and fees">
          <Input
            id={`${id}-taxes`}
            inputMode="decimal"
            value={taxes}
            className="tabular-nums"
            onChange={(e) => setTaxes(e.target.value)}
          />
        </Field>
      </div>
      {schedule ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedule.map((i) => (
              <TableRow key={i.number}>
                <TableCell className="tabular-nums text-muted-foreground">{i.number}</TableCell>
                <TableCell className="tabular-nums">
                  {i.number === 1 ? "At bind" : formatPlainDate(i.dueOn.toString())}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(i.total)}
                  {!i.fee.isZero() && (
                    <span className="block text-xs text-muted-foreground">
                      incl. {money(i.fee)} fee
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {total && (
              <TableRow>
                <TableCell />
                <TableCell className="font-medium">Total</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {money(total)}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      ) : (
        <p className="m-0 p-(--card-p) text-sm text-muted-foreground">
          Enter a premium to see the schedule.
        </p>
      )}
    </Panel>
  );
}

function Collections({
  billing,
  readOnly,
  onChange,
}: {
  billing: BillingConfig;
  readOnly: boolean;
  onChange: (next: BillingConfig) => void;
}) {
  const id = useId();
  const dunning = billing.dunning;

  const update = (changes: Partial<BillingConfig["dunning"]>) =>
    onChange({ ...billing, dunning: { ...dunning, ...changes } });

  return (
    <Panel
      title="Autopay and nonpayment"
      description="Notice periods and delivery come from the notice rules for nonpayment."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id={`${id}-retry`} label="Retry autopay after (days)">
          <Input
            id={`${id}-retry`}
            type="number"
            min={0}
            value={dunning.retryAfterDays}
            disabled={readOnly}
            className="tabular-nums"
            onChange={(e) => update({ retryAfterDays: number(e.target.value) })}
          />
        </Field>
        <Field id={`${id}-retries`} label="Retries">
          <Input
            id={`${id}-retries`}
            type="number"
            min={0}
            value={dunning.retries}
            disabled={readOnly}
            className="tabular-nums"
            onChange={(e) => update({ retries: number(e.target.value) })}
          />
        </Field>
        <Field id={`${id}-reminder`} label="Reminder after due (days)">
          <Input
            id={`${id}-reminder`}
            type="number"
            min={0}
            value={dunning.reminderAfterDays}
            disabled={readOnly}
            className="tabular-nums"
            onChange={(e) => update({ reminderAfterDays: number(e.target.value) })}
          />
        </Field>
        <Field id={`${id}-source`} label="Nonpayment starts from">
          <SegmentedControl
            label="Nonpayment starts from"
            value={dunning.delinquencySource}
            options={[
              { value: "pas", label: "Grace period", disabled: readOnly },
              { value: "billing_system", label: "Billing system", disabled: readOnly },
            ]}
            onValueChange={(delinquencySource) => update({ delinquencySource })}
          />
        </Field>
      </div>
    </Panel>
  );
}

const METHODS = [
  { value: "direct", label: "Direct bill", hint: "The insured pays by card, in full or by plan." },
  {
    value: "agency",
    label: "Agency bill",
    hint: "Approved agencies bind without collecting and remit on a monthly account current.",
  },
  {
    value: "mortgagee",
    label: "Mortgagee bill",
    hint: "The lender is invoiced on a pay-in-full plan offered when the mortgagee pays.",
  },
] as const;

const dayList = (value: string) =>
  value
    .split(",")
    .map((d) => Number(d.trim()))
    .filter((d) => Number.isInteger(d) && d > 0);

function BillingMethods({
  billing,
  readOnly,
  onChange,
}: {
  billing: BillingConfig;
  readOnly: boolean;
  onChange: (next: BillingConfig) => void;
}) {
  const id = useId();
  const mortgagee = billing.mortgagee;
  const [reminders, setReminders] = useState(mortgagee.reminderDays.join(", "));

  const toggle = (method: BillingConfig["methods"][number], on: boolean) =>
    onChange({
      ...billing,
      methods: METHODS.map((m) => m.value).filter((m) =>
        m === method ? on : billing.methods.includes(m),
      ),
    });

  const update = (changes: Partial<BillingConfig["mortgagee"]>) =>
    onChange({ ...billing, mortgagee: { ...mortgagee, ...changes } });

  return (
    <Panel title="Billing methods" description="Who can be billed when a quote is bound.">
      <div className="grid gap-6">
        <div className="grid gap-3">
          {METHODS.map((m) => (
            <label key={m.value} className="flex items-start gap-3">
              <Checkbox
                checked={billing.methods.includes(m.value)}
                disabled={readOnly}
                onCheckedChange={(checked) => toggle(m.value, checked === true)}
                className="mt-0.5"
              />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{m.label}</span>
                <span className="text-sm text-muted-foreground">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {billing.methods.includes("mortgagee") && (
          <div className="grid gap-4 border-t pt-6 sm:grid-cols-2 lg:grid-cols-4">
            <Field id={`${id}-due`} label="Lender invoice due (days)">
              <Input
                id={`${id}-due`}
                type="number"
                min={0}
                value={mortgagee.dueDays}
                disabled={readOnly}
                className="tabular-nums"
                onChange={(e) => update({ dueDays: number(e.target.value) })}
              />
            </Field>
            <Field id={`${id}-reminders`} label="Lender reminders (days)">
              <Input
                id={`${id}-reminders`}
                value={reminders}
                disabled={readOnly}
                className="tabular-nums"
                placeholder="15, 30"
                onChange={(e) => setReminders(e.target.value)}
                onBlur={() => update({ reminderDays: dayList(reminders) })}
              />
            </Field>
            <Field id={`${id}-offer`} label="Offer direct bill after (days)">
              <Input
                id={`${id}-offer`}
                type="number"
                min={0}
                value={mortgagee.offerDirectAfterDays}
                disabled={readOnly}
                className="tabular-nums"
                onChange={(e) => update({ offerDirectAfterDays: number(e.target.value) })}
              />
            </Field>
            <Field id={`${id}-nonpay`} label="Nonpayment after (days)">
              <Input
                id={`${id}-nonpay`}
                type="number"
                min={0}
                value={mortgagee.nonpaymentAfterDays}
                disabled={readOnly}
                className="tabular-nums"
                onChange={(e) => update({ nonpaymentAfterDays: number(e.target.value) })}
              />
            </Field>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Field({
  id,
  label,
  optional,
  className,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("grid content-start gap-2", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">Optional</span>}
      </Label>
      {children}
    </div>
  );
}
