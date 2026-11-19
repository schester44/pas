// Seeds "Lakeside Mutual (mock)": carrier, test and live connections to the dev mock carrier, a
// configured connector recorded against the mock and published, and Homeowners Coastal 2028.1
// written through it. Idempotent; never touches published versions or drafts it didn't create.
import {
  type CanonicalInput,
  type Capability,
  type ConnectorDefinition,
  runFlow,
  sampleInput,
} from "@pas/carriers";
import {
  MOCK_CARRIER_API_KEY,
  MOCK_CARRIER_CALLBACK_SECRET,
  MockCarrier,
} from "@pas/carriers/infrastructure";
import { asId, newId, type TenantContext, type WorkflowStep } from "@pas/kernel";
import { compose } from "../composition";

const TENANT_SLUG = "acme-mga";
const PRODUCT_NAME = "Homeowners Coastal";
const VERSION = "2028.1";
const NEW_BUSINESS_FROM = "2028-06-01";
const RENEWAL_FROM = "2028-08-01";
const CARRIER_KEY = "lakeside-mutual";
const MOCK_URL = process.env.MOCK_CARRIER_URL ?? "http://localhost:4000/dev/mock-carrier";

const auth = { authorization: "Bearer {{ steps.session.output.token }}" };

const session = {
  kind: "request" as const,
  id: "session",
  name: "Create session token",
  method: "POST" as const,
  path: "/sessions",
  body: '{ client: "pas" }',
  response: "{ token: response.sessionToken }",
  errors: [{ when: "status == 403", message: "Lakeside refused the API key" }],
};

const lines = (source: string) =>
  `map(${source}, { coverage: #.coverage, exposure: #.exposure, amount: string(#.amount) })`;

const premiumOf = (source: string) =>
  `${source} == null ? null : { currency: "USD", lines: ${lines(`${source}.lines`)}, taxesFees: map(${source}.fees ?? [], { code: #.code, label: #.label, amount: string(#.amount) }) }`;

const ourLines =
  "map(filter(input.coverages, #.premium != null), { coverage: #.code, exposure: #.exposure, amount: number(#.premium.amount) })";

export const LAKESIDE_CONNECTOR: ConnectorDefinition = {
  defaults: {
    headers: { "content-type": "application/json", accept: "application/json" },
    timeoutMs: 15_000,
    retry: { attempts: 3, backoff: "exponential", delaySeconds: 2 },
  },
  callbacks: { correlation: "body.applicationId" },
  capabilities: {
    quote: {
      steps: [
        session,
        {
          kind: "request",
          id: "submit",
          name: "Submit application",
          method: "POST",
          path: "/applications",
          headers: auth,
          idempotencyKey: "{{ input.quote.id }}-r{{ input.quote.revision }}",
          body: `{ applicant: { name: input.insured.name, mailingAddress: input.insured.mailingAddress }, state: input.jurisdiction.subdivision, effectiveDate: input.term.effectiveDate, risk: input.risk, coverages: ${ourLines}, callbackUrl: callback.url }`,
          response: "{ applicationId: response.applicationId }",
          errors: [
            {
              when: "status == 422",
              message: "Lakeside rejected the application: {{ body.message }}",
            },
          ],
        },
        {
          kind: "poll",
          id: "decision",
          name: "Wait for the decision",
          request: {
            method: "GET",
            path: "/applications/{{ steps.submit.output.applicationId }}",
            headers: auth,
          },
          until: 'response.status != "pending"',
          intervalSeconds: 2,
          backoffFactor: 1.5,
          maxIntervalSeconds: 5,
          maxWaitSeconds: 60,
        },
        {
          kind: "branch",
          id: "route",
          name: "Referred?",
          cases: [{ when: 'steps.decision.body.status == "referred"', goto: "underwriting" }],
          otherwise: "result",
        },
        {
          kind: "await_callback",
          id: "underwriting",
          name: "Wait for Lakeside underwriting",
          correlation: "{{ steps.submit.output.applicationId }}",
          timeoutSeconds: 86_400,
          response:
            "{ status: callback.decision, premium: callback.premium, messages: callback.messages }",
        },
        {
          kind: "map",
          id: "result",
          name: "Decision",
          expression:
            "steps.underwriting.output != null ? steps.underwriting.output : { status: steps.decision.body.status, premium: steps.decision.body.premium, messages: steps.decision.body.messages }",
        },
      ],
      output: `{ status: steps.result.output.status, reference: steps.submit.output.applicationId, premium: ${premiumOf("steps.result.output.premium")}, messages: steps.result.output.messages ?? [] }`,
    },
    bind: {
      steps: [
        session,
        {
          kind: "request",
          id: "bind",
          name: "Request binder",
          method: "POST",
          path: "/applications/{{ input.carrier.reference }}/binds",
          headers: auth,
          idempotencyKey: "bind-{{ input.quote.id }}",
          response: "{ bindId: response.bindId }",
        },
        {
          kind: "compensate",
          id: "void_binder",
          name: "Void the binder",
          request: {
            method: "POST",
            path: "/binds/{{ steps.bind.output.bindId }}/void",
            headers: auth,
          },
        },
        {
          kind: "request",
          id: "confirm",
          name: "Confirm binder",
          method: "POST",
          path: "/binds/{{ steps.bind.output.bindId }}/confirm",
          headers: auth,
          errors: [{ when: "status == 422", message: "{{ body.message }}" }],
        },
      ],
      output: '{ status: "bound", reference: steps.bind.output.bindId, messages: [] }',
    },
    issue: {
      steps: [
        session,
        {
          kind: "request",
          id: "issue",
          name: "Issue policy",
          method: "POST",
          path: "/binds/{{ input.carrier.reference }}/issue",
          headers: auth,
          idempotencyKey: "issue-{{ input.carrier.reference }}",
        },
      ],
      output:
        '{ status: "issued", reference: input.carrier.reference, policyNumber: steps.issue.body.policyNumber, documents: map(steps.issue.body.documents, { title: #.title, url: #.href, kind: "carrier_declarations" }), messages: [] }',
    },
    endorse: {
      steps: [
        session,
        {
          kind: "request",
          id: "endorse",
          name: "Submit endorsement",
          method: "POST",
          path: "/policies/{{ input.policy.carrierNumber }}/endorsements",
          headers: auth,
          idempotencyKey: "{{ input.transaction.id }}",
          body: `{ effectiveDate: input.transaction.effectiveDate, premiumChange: ${ourLines} }`,
        },
      ],
      output: `{ status: "confirmed", reference: steps.endorse.body.endorsementId, premium: ${premiumOf("steps.endorse.body.premium")}, messages: [] }`,
    },
    cancel: {
      steps: [
        session,
        {
          kind: "request",
          id: "cancel",
          name: "Submit cancellation",
          method: "POST",
          path: "/policies/{{ input.policy.carrierNumber }}/cancellations",
          headers: auth,
          idempotencyKey: "{{ input.transaction.id }}",
          body: `{ effectiveDate: input.transaction.effectiveDate, reason: input.transaction.reason, returnPremium: ${ourLines} }`,
        },
      ],
      output: `{ status: "confirmed", reference: steps.cancel.body.cancellationId, premium: ${premiumOf("steps.cancel.body.returnPremium")}, messages: [] }`,
    },
  },
};

const OWNERSHIP = {
  transactions: {
    new_business: "carrier",
    endorsement: "carrier",
    cancellation: "carrier",
    reinstatement: "pas",
  },
  rating: "carrier",
  lineItems: "carrier",
  documents: { source: "both", order: "tenant_first" },
  policyNumber: "both",
  billing: "agency_bill",
};

const container = compose();
await container.clocks.start();
const { prisma } = container;
const carriers = container.carriers;
const uc = container.useCases;

const tenant = await prisma.organization.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });

const owner = await prisma.member.findFirstOrThrow({
  where: { organizationId: tenant.id, role: "owner" },
});

const ctx: TenantContext = {
  tenantId: asId(tenant.id),
  actor: { type: "user", userId: asId(owner.userId) },
};

/** Runs a flow in this process against an in-process mock, to record fixtures. */
async function record(
  definition: ConnectorDefinition,
  capability: Capability,
  input: CanonicalInput,
) {
  const callbacks = new Map<string, unknown>();

  const mock = new MockCarrier({
    deliver: async (_url, body) => {
      const parsed = JSON.parse(body) as { applicationId: string };

      callbacks.set(parsed.applicationId, parsed);
    },
  });

  const memo = new Map<string, unknown>();

  const exchanges: {
    stepId: string;
    method: string;
    url: string;
    response: unknown;
    error: string | null;
  }[] = [];

  const received: { body: unknown }[] = [];

  const step: WorkflowStep = {
    run: async (id, fn) => {
      if (!memo.has(id)) memo.set(id, JSON.parse(JSON.stringify((await fn()) ?? null)));

      return memo.get(id) as never;
    },
    delay: async (_id, duration) => {
      const seconds = typeof duration === "string" ? 1 : (duration.seconds ?? 1);

      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    },
    waitFor: (async (event: string) => {
      const key = event.replace("carrier.callback:", "");

      for (let i = 0; i < 40 && !callbacks.has(key); i++)
        await new Promise((r) => setTimeout(r, 500));

      const body = callbacks.get(key);

      if (body) received.push({ body });

      return body ? { body } : undefined;
    }) as WorkflowStep["waitFor"],
  };

  let current = "";

  const result = await runFlow(
    step,
    {
      send: async (request) => {
        const headers = { ...request.headers, "x-api-key": MOCK_CARRIER_API_KEY };
        const path = new URL(request.url).pathname.replace(/^\/dev\/mock-carrier/, "");

        const response = await mock.handle({
          method: request.method,
          path,
          headers,
          body: request.body ?? null,
        });

        return {
          ok: true,
          response: { status: response.status, headers: {}, body: response.body },
          durationMs: 1,
        };
      },
      record: async (exchange) => {
        current = exchange.stepId;

        if (exchange.kind === "callback") return;

        exchanges.push({
          stepId: current,
          method: exchange.request.method ?? "GET",
          url: exchange.request.url ?? "",
          response: exchange.response,
          error: exchange.response ? null : exchange.error,
        });
      },
      awaitCallback: async () => {},
    },
    {
      definition,
      flow: definition.capabilities[capability]!,
      input: input as unknown as Record<string, unknown>,
      connection: { environment: "test", baseUrl: MOCK_URL },
      callbackUrl: "http://localhost/callback",
      runId: newId(),
    },
  );

  return { result, exchanges, callbacks: received, mock };
}

async function seedCarrier() {
  const listed = await carriers.manage.list(ctx);
  const existing = listed.find((c) => c.key === CARRIER_KEY);

  const carrier =
    existing ??
    (await carriers.manage.save(ctx, {
      key: CARRIER_KEY,
      name: "Lakeside Mutual (mock)",
      naic: "29714",
      amBest: "A (Excellent)",
      admitted: ["US-IL", "US-IN"],
      lines: ["Homeowners"],
      mode: "connector",
      activeEnvironment: "test",
    }));

  for (const environment of ["test", "live"] as const) {
    await carriers.manage.saveConnection(ctx, {
      carrierId: carrier.id,
      environment,
      baseUrl: MOCK_URL,
      auth: { kind: "api_key", header: "x-api-key" },
      callback: { signature: "hmac_sha256", header: "x-carrier-signature" },
      secrets: { apiKey: MOCK_CARRIER_API_KEY, callbackSecret: MOCK_CARRIER_CALLBACK_SECRET },
    });
  }

  return carrier;
}

async function seedConnector(carrierId: string) {
  const detail = await carriers.manage.get(ctx, { id: carrierId });

  if (detail.versions.some((v) => v.status === "published")) return "connector already published";

  const draft = await carriers.connector.createDraft(ctx, { carrierId });

  await carriers.connector.update(ctx, {
    id: draft.id,
    definition: LAKESIDE_CONNECTOR,
    note: "Initial connector",
  });

  if ((await carriers.connector.fixtures(ctx, { carrierId })).length === 0) {
    await recordFixtures(carrierId);
  }

  const published = await carriers.connector.publish(ctx, {
    id: draft.id,
    note: "Recorded against the mock carrier",
  });

  return `connector v${published.version} published`;
}

async function recordFixtures(carrierId: string) {
  const quote = sampleInput("quote");
  const named = (name: string) => ({ ...quote, insured: { ...quote.insured, name } });

  const quoted = await record(LAKESIDE_CONNECTOR, "quote", quote);
  const referred = await record(LAKESIDE_CONNECTOR, "quote", named("Riley Refer"));

  const bindInput = { ...quote, carrier: { reference: quoted.result.outcome.reference! } };
  const binding = await recordWith(quoted.mock, "bind", bindInput);
  const issueInput = { ...quote, carrier: { reference: binding.result.outcome.reference! } };
  const issued = await recordWith(quoted.mock, "issue", issueInput);

  const failQuote = await record(LAKESIDE_CONNECTOR, "quote", named("Casey Fail Bind"));

  const failBind = await recordWith(failQuote.mock, "bind", {
    ...named("Casey Fail Bind"),
    carrier: { reference: failQuote.result.outcome.reference! },
  });

  const number = issued.result.outcome.policyNumber!;

  const change = (capability: Capability) => ({
    ...sampleInput(capability),
    policy: { id: "sample-policy", number: "HO-000123", carrierNumber: number },
  });

  const endorsed = await recordWith(quoted.mock, "endorse", change("endorse"));
  const cancelled = await recordWith(quoted.mock, "cancel", change("cancel"));

  const fixtures = [
    ["quote", "Quoted after polling", quote, quoted],
    ["quote", "Referred, decided by callback", named("Riley Refer"), referred],
    ["bind", "Binder confirmed", bindInput, binding],
    ["bind", "Binder rejected, voided", failBind.input, failBind],
    ["issue", "Issued with declarations", issueInput, issued],
    ["endorse", "Endorsement processed", change("endorse"), endorsed],
    ["cancel", "Cancellation processed", change("cancel"), cancelled],
  ] as const;

  for (const [capability, name, input, run] of fixtures) {
    await prisma.carrierFixture.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        carrierId,
        capability,
        name,
        input: JSON.parse(JSON.stringify(input)),
        exchanges: JSON.parse(JSON.stringify(run.exchanges)),
        callbacks: JSON.parse(JSON.stringify(run.callbacks)),
        expected: JSON.parse(JSON.stringify(run.result.outcome)),
        createdAt: new Date(),
      },
    });
  }
}

async function recordWith(mock: MockCarrier, capability: Capability, input: CanonicalInput) {
  const memo = new Map<string, unknown>();

  const exchanges: {
    stepId: string;
    method: string;
    url: string;
    response: unknown;
    error: string | null;
  }[] = [];

  const result = await runFlow(
    {
      run: async (id, fn) => {
        if (!memo.has(id)) memo.set(id, JSON.parse(JSON.stringify((await fn()) ?? null)));

        return memo.get(id) as never;
      },
      delay: async () => {},
      waitFor: (async () => undefined) as WorkflowStep["waitFor"],
    },
    {
      send: async (request) => {
        const path = new URL(request.url).pathname.replace(/^\/dev\/mock-carrier/, "");

        const response = await mock.handle({
          method: request.method,
          path,
          headers: { ...request.headers, "x-api-key": MOCK_CARRIER_API_KEY },
          body: request.body ?? null,
        });

        return {
          ok: true,
          response: { status: response.status, headers: {}, body: response.body },
          durationMs: 1,
        };
      },
      record: async (exchange) => {
        exchanges.push({
          stepId: exchange.stepId,
          method: exchange.request.method ?? "GET",
          url: exchange.request.url ?? "",
          response: exchange.response,
          error: exchange.response ? null : exchange.error,
        });
      },
      awaitCallback: async () => {},
    },
    {
      definition: LAKESIDE_CONNECTOR,
      flow: LAKESIDE_CONNECTOR.capabilities[capability]!,
      input: input as unknown as Record<string, unknown>,
      connection: { environment: "test", baseUrl: MOCK_URL },
      callbackUrl: "http://localhost/callback",
      runId: newId(),
    },
  );

  return { result, exchanges, callbacks: [] as { body: unknown }[], input };
}

async function seedVersion() {
  const product = await prisma.product.findFirstOrThrow({
    where: { tenantId: tenant.id, name: PRODUCT_NAME },
  });

  const versions = await prisma.productVersion.findMany({
    where: { productId: product.id },
    orderBy: { createdAt: "asc" },
  });

  const existing = versions.find((v) => v.version === VERSION);

  if (existing?.status === "PUBLISHED") return `${VERSION} already published`;

  if (
    existing &&
    (existing.lifecycle as { carrier?: { carrier?: string } }).carrier?.carrier !== CARRIER_KEY
  ) {
    return `${VERSION} exists and isn't ours; left alone`;
  }

  const base = versions.filter((v) => v.status === "PUBLISHED").at(-1);

  if (!base) throw new Error(`${PRODUCT_NAME} has no published version to copy`);

  const draft =
    existing ??
    (await uc.catalog.createVersion(ctx, {
      productId: product.id,
      version: VERSION,
      copyFromId: base.id,
    }));

  const current = await uc.catalog.getVersion(ctx, { id: draft.id });

  await uc.catalog.updateVersion(ctx, {
    id: draft.id,
    lifecycle: { ...current.lifecycle, carrier: { carrier: CARRIER_KEY, ownership: OWNERSHIP } },
    availability: current.availability.map((window) => ({
      ...window,
      market: "admitted",
      newBusiness: { from: NEW_BUSINESS_FROM },
      renewal: { from: RENEWAL_FROM },
    })),
  });

  const issues = await uc.catalog.checkVersion(ctx, { id: draft.id });
  const errors = issues.filter((i) => i.severity === "error");

  if (errors.length > 0)
    return `${VERSION} has ${errors.length} errors: ${JSON.stringify(errors).slice(0, 400)}`;

  if (current.status === "draft") await uc.catalog.submitVersion(ctx, { id: draft.id });

  await uc.catalog.publishVersion(ctx, { id: draft.id });

  return `${VERSION} published from ${base.version}`;
}

const carrier = await seedCarrier();
console.info(`carrier ${carrier.name}`);
console.info(await seedConnector(carrier.id));
console.info(await seedVersion());

await container.queues.stop();
await container.workflows.close();
container.clocks.stop();
process.exit(0);
