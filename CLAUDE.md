# CLAUDE.md

Working agreement for AI agents and contributors. Read [`PLAN.md`](./PLAN.md) before making structural changes. It's the source of truth for architecture, and this file is the short list of rules that keep the code aligned with it.

## What this is

A multi-tenant, configuration-driven P&C Policy Administration System. Tenants configure products in `apps/admin`; agents and customers transact in `apps/app`; partners use the REST API. **Product behavior is configuration, not code.**

## Hard rules

1. **No product, carrier or state names in domain or application code.** No `if (carrier === "x")`, no `if (state === "TX")`, no `isHomeowners`. Variability goes in config, decision tables, adapters or extensions. If you think you need a branch like that, the config model is missing a concept. Raise it instead.
2. **Hexagonal boundaries** (enforced by oxlint `no-restricted-imports`):
   - `domain/` imports only `@pas/kernel` and its own `domain/` files. No I/O, no Prisma, no zod, no framework.
   - `application/` depends on `domain/` and `ports/`. Never on `@pas/db`, `@prisma/*`, `pg-boss`, `fastify`, `@trpc/*` or `infrastructure/`.
   - Only `infrastructure/` imports `@pas/db` / Prisma. Prisma types never leave a repository. Map to domain objects.
   - Modules import other modules only through `@pas/<module>` (`public.ts`). No deep imports, no reading another context's tables.
   - Only apps (composition roots) import `@pas/<module>/infrastructure`.
3. **Tenant scoping is mandatory.** Every tenant-owned table has `tenant_id`; every repository method takes a `TenantContext`; every query handler takes a `Scope` (agency/customer data scoping). Unscoped access exists only in explicitly platform-level code.
4. **Published configuration is immutable.** Never mutate a published ProductVersion, ProductRelease, decision release, rating plan, workbook rater, template or extension. Create a new version.
5. **Pin versions.** Quotes, terms and transactions reference a `productReleaseId`. Never re-resolve config for an existing quote, term or transaction unless the product's lifecycle config says so.
6. **Never mutate issued transactions.** Corrections are new transactions (`REVERSAL`, offsets, rerolls). Issued TermVersions are append-only.
7. **Money is `Money` (decimal), never `number`.** Rounding is explicit and comes from config.
8. **Dates**: effective dates are `PlainDate` (jurisdiction-local); timestamps are `Instant`. Always get "now" from the `Clock` port, never from `new Date()` or `Date.now()` in domain or application code. Sandboxes depend on this.
9. **Side effects go through domain events + the outbox.** Use cases call `outbox.add(tx, aggregate.pullEvents())` inside the unit of work; the pg-boss adapter enqueues in the same DB transaction. Don't call queues, email, carriers, filings or billing directly from a use case. Handlers are idempotent on event ID.
10. **External systems only through ports.** Each external system (carrier, data vendor, filing channel, mail, e-sign) gets a fake adapter so sandboxes and local dev run without it.
11. **Compliance numbers are content, not code.** Notice days, filing deadlines, tax/fee rates, mandatory wording: all in decision tables or jurisdiction packs. Never hard-code them, even as defaults.
12. **AI never mutates directly.** AI features call the same application use cases as a user (under the user's RBAC), and their output is a draft/changeset that passes the normal publish gates. Keep config typed and statically checkable so AI output can be verified mechanically.

## Layout

```
apps/{api,worker,admin,app}            composition roots + delivery (tRPC/REST routers, job handlers, SPAs)
packages/kernel                        shared kernel
packages/modules/<context>/src/
  domain/  application/  ports/  infrastructure/  public.ts  infrastructure.ts
packages/engines/*                     (planned) expressions, forms-core, forms-react, decision-engine, rating-engine
packages/{db,queues,auth,api-client,ui,storage,observability}
docs/                                  research and design notes
```

`packages/modules/catalog` is the reference module: copy its shape (aggregate → port → use-case factory → Prisma repository → `public.ts` / `infrastructure.ts` → wired in `apps/api/src/composition.ts` → thin tRPC procedure).

Wiring at a glance:

- `apps/api`: Fastify. Better Auth at `/api/auth/*`, tRPC at `/trpc/admin` and `/trpc/app`. Procedures: `publicProcedure` → `authedProcedure` → `tenantProcedure` (builds `TenantContext` from the active organization) → `requirePermission({ resource: [actions] })`.
- `apps/worker`: pg-boss consumers. Domain events arrive on the `domain-events` queue and are dispatched by `type` in `src/index.ts`.
- `apps/admin` (port 5173) and `apps/app` (port 5174): Vite SPAs that proxy `/api` and `/trpc` to the API (port 4000) in dev, so auth cookies are same-origin.
- Permissions and roles: `packages/auth/src/permissions.ts` (shared by server and SPAs).

Bounded contexts: identity, catalog, data-dictionary, forms, decisions, rating, documents, distribution, parties, submissions, underwriting, policy, billing, capacity, compliance, enrichment, extensions, integrations, notifications, audit. See PLAN §4 for what each owns.

## Conventions

- **Comments: almost none.** Code explains itself through clean architecture, small functions and precise names. Don't narrate what code does, don't restate types, don't leave section banners or TODO essays. Write a comment only for a non-obvious _why_ (a regulatory rule, a vendor quirk, a deliberate trade-off), in one short line.
- **No duplicate helpers.** Search before writing a utility; if it exists, import it, and if it's generic, put it in its shared home instead of a local copy:
  - `@pas/kernel`: `isRecord`, `toPlainJson`, `canonicalJson`, `formatMoney`, `formatPlainDate`, `jurisdictionCode`, date parsing, `Money`.
  - `@pas/db` (infrastructure only): `instantFromDb`/`instantToDb`, `plainDateFromDb`/`plainDateToDb`, `moneyFromDb`, `jsonToDb`.
  - `@pas/forms-core`: risk-schema walking, exposure paths and labels, address values.
  - `@pas/ui`: presentational formatting and components shared by the SPAs.
  - `pnpm lint` runs `scripts/check-duplicate-helpers.ts`, which fails when a listed helper is defined outside its home; add new shared helpers to its list.
- **Vertical spacing is enforced** (`@stylistic/padding-line-between-statements` via oxlint): blank line before `return`, around `if`/loops/`switch`/`try`, and around multi-line statements. `pnpm lint:fix` applies it.
- **Use cases**: one file per command/query in `application/`, named verb-first (`bindQuote.ts`, `issueTransaction.ts`, `listSubmissions.ts`). Built by factories that take their ports: `makeBindQuote({ uow, rater, clock })`.
- **Aggregates** enforce their own invariants and record domain events. State transitions are methods (`term.scheduleCancellation(...)`), never field assignment from outside.
- **State machines** are explicit transition tables in `domain/`, with guards that receive resolved config/decision results as arguments. The domain never fetches config itself.
- **Errors**: throw `DomainError` subclasses with stable `code`s. Delivery adapters map codes to tRPC/HTTP errors. Never surface Prisma errors to clients.
- **Validation**: zod at the edges (tRPC input, REST, queue payloads, config import). Domain types are plain TS.
- **Routers are thin**: auth → context/scope → parse → use case → map. No business logic in routers or job handlers.
- **Queues**: define in `packages/queues/src/queues/<name>.ts` with `defineQueue({ name, schema, queueOptions, sendOptions })`, add it to `allQueues`, send with `queueClient.send(def, data)`, and register the handler in `apps/worker` with `queueClient.work(def, handler)`. Payloads are zod-validated on both ends and carry trace context automatically.
- **Database**: Prisma 7 multi-file schema in `packages/db/src/prisma/schema/<context>.prisma`; snake_case via `@map`; `@db.Timestamptz(6)`; UUIDv7 IDs (generated in the domain via `newId()`); tenant-leading composite indexes. Every new tenant-owned table gets an RLS policy in its migration (copy `*_tenant_rls/migration.sql`). RLS only binds non-owner roles: deployed api/worker connect as `pas_app` (`pnpm db:app-role`, `packages/db/sql/app-role.sql`); migrations and pg-boss installs run as the owner. Local dev connects as the owner, so RLS isn't exercised there. One-off data fixes are data migrations (`packages/db/src/data-migrations`), not ad-hoc scripts.
- **Better Auth tables** live in `packages/db/src/prisma/schema/auth.prisma` and are maintained by hand. When enabling a Better Auth plugin, add its fields there (check the plugin's `schema` in `node_modules/better-auth/dist/plugins/<plugin>/schema.d.mts`).
- **Frontend**: TanStack Router file routes, TanStack Query via the tRPC client from `@pas/api-client`, shadcn components from `@pas/ui`. Forms built from config render through `@pas/forms-react`. Never re-implement form logic in a page.
- **Jurisdictions** are `country + subdivision`, never a bare US state code. Money always carries a currency. User-facing strings go through i18n.
- **UI**: follow `docs/design.md`. No vibe-coded UI.
- **Naming**: domain language from PLAN.md (Submission, Quote, PolicyTerm, PolicyTransaction, TermVersion, ProductRelease, Obligation, …). Don't invent synonyms.

## Testing: keep it lean

Tests are for the code where a bug costs real money or breaks the law, not a ritual for every change. Over-testing slows the SDLC more than it protects us. We can add tests later when something proves fragile.

**Do test** (small, focused, mostly pure unit tests):

- Money, rounding, proration, earned/unearned and premium deltas.
- Lifecycle state machine transitions and guards (term, transaction, renewal).
- Rating and decision engine evaluation (engine code, not individual tenant configs).
- Compliance date math: notice earliest-valid dates, filing deadlines.
- Tenant isolation at the repository / unit-of-work level.

**Don't write tests for**: tRPC/REST routers, React components and pages, simple CRUD use cases, mappers, DTOs, composition roots, config files or framework glue. Typecheck, lint and a quick manual run are enough there.

**Rules of thumb**

- Don't add tests unless the change touches the "do test" list above, or the user asks.
- Prefer one meaningful test over many small ones. Don't mock everything to test wiring.
- Don't build test infrastructure (factories, harnesses, contract suites) ahead of need.
- Verify behavior by running the thing (`pnpm dev`, curl the endpoint) when that's faster than writing a test.
- Tenant-authored config (rating golden cases, decision test cases) is a _product feature_ tested in the admin publish flow; that's separate from code tests.

## Commands

```bash
pnpm dev                    # api :4000, worker, admin :5173, app :5174 (turbo)
pnpm typecheck | lint | fmt | test | build
pnpm db:generate            # Prisma client
pnpm db:migrate             # create + apply a migration (prisma migrate dev)
pnpm db:reset
```

Environment lives in the root `.env` (copy `.env.example`). Node 26+ (native `Temporal`), pnpm 12.

Run `pnpm typecheck && pnpm lint` before declaring work done (`pnpm test` if you touched tested code).

## When unsure

- Domain semantics (lifecycle, rating, compliance): check PLAN.md. If it's silent, ask. Don't guess insurance rules.
- New cross-context dependency: prefer an event or a `public.ts` query over a new synchronous coupling, and note it in PLAN.md.
- Changes to money math, lifecycle transitions or compliance date math should come with a focused test.
