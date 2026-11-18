# PAS

A multi-tenant, configuration-driven **Policy Administration System** for P&C insurance, built for MGAs, program administrators and carriers who want to launch and change products in days, not quarters.

Tenants define their products in **admin**: risk data, intake forms, underwriting rules, rating (algorithm plans or uploaded spreadsheets), documents, lifecycle behavior, surplus-lines and notice compliance. Agents and customers then quote, bind and service those products through **app**, an embeddable widget, or the public API. Changing a product is a versioned, effective-dated, tested configuration release, not a code deploy.

> Status: **Phase 0 scaffold**: the stack runs end to end with one example module (catalog → products). Read [`PLAN.md`](./PLAN.md) for where it's going.

## Surfaces

| Surface          | Who                        | What                                                                                                      |
| ---------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `admin.pas.com`  | Tenant staff               | Product configuration + internal operations (UW queue, policies, transactions, compliance), gated by RBAC |
| `app.pas.com`    | Agents, brokers, customers | Quote, bind, service, renew; tenant-branded; custom domains                                               |
| Embed            | Partner sites              | Drop-in quote/bind flow                                                                                   |
| `api.pas.com/v1` | Partner systems            | REST + OpenAPI, API keys, webhooks                                                                        |

## Key ideas

- **Product Release manifest**: every quote, term and transaction pins an immutable "lockfile" of the exact schema, forms, rules, rater, documents and lifecycle config versions it used. Results are reproducible forever, and config caches never need invalidation.
- **One lifecycle, many products**: generic state machines for submissions, terms, transactions and renewals. Product, carrier and state differences come in only as guards, parameters and effects from config.
- **Full-term rating, PAS-side proration**: raters price a term state; the platform computes deltas, proration, earned/unearned and out-of-sequence rerolls.
- **Two rating engines, one contract**: admin-authored rating plans (tables + algorithm steps) or uploaded Excel workbooks executed in-process, both effective-dated and golden-tested.
- **Rules as versioned decision graphs** (GoRules ZEN / JDM) using the [workbench](https://github.com/schester44/workbench) versioning model.
- **Compliance obligation engine**: SL filings, diligent-search affidavits, notices with proof of mailing, bordereaux and adverse-action notices, all driven by jurisdiction content.
- **Hexagonal + DDD**: domain code has no idea Prisma, pg-boss or Fastify exist. Every external system sits behind a port with a fake adapter for local dev and sandboxes.

## Stack

TypeScript · Node 26 · pnpm + Turborepo · Fastify · tRPC (dashboards) · REST/OpenAPI (public) · React 19 + Vite + TanStack Router/Query · shadcn/ui + Tailwind v4 · Postgres + Prisma 7 · pg-boss (separate worker) · Better Auth (organizations = tenants, RBAC) · GoRules ZEN · OpenTelemetry · oxlint + oxfmt · vitest

## Repository layout

```
apps/
  api/        Fastify: tRPC (admin, app), REST /v1, auth, inbound webhooks
  worker/     pg-boss: events, timers, documents, rating batch, integrations
  admin/      admin.pas.com SPA
  app/        app.pas.com SPA + embed bundle
packages/
  kernel/     shared kernel (Money, ids, dates, errors, Clock)
  modules/    one package per bounded context (domain / application / ports / infrastructure)
  engines/    (planned) expressions, forms-core, forms-react, decision-engine, rating-engine
  db/  queues/  auth/  api-client/  ui/  storage/  observability/
docs/
  landscape.md   competitive research and what it changed in the plan
```

## Getting started

Requires Node 26+, pnpm 12 and Postgres 17+ (local install, or `docker compose up -d`).

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL and BETTER_AUTH_SECRET (openssl rand -hex 32)
createdb pas                  # skip if using docker compose
pnpm db:generate
pnpm --filter @pas/db exec prisma migrate deploy
pnpm dev                      # api :4000 · worker · admin :5173 · app :5174
```

In local dev the app connects as the database owner, so Postgres row-level security is not enforced (owners bypass it). Deployed environments run migrations and `pnpm queues:setup` (pg-boss schema and queues) as the owner (`DATABASE_URL_OWNER`), set `PGBOSS_MANAGE_SCHEMA=false` for the api and worker, then create the non-owner app role once with `PAS_APP_PASSWORD=... pnpm db:app-role` ([`packages/db/sql/app-role.sql`](./packages/db/sql/app-role.sql)) and point the api and worker's `DATABASE_URL` at `pas_app`.

Open http://localhost:5173, create an account, create an organization (your tenant), then add a product. The worker logs the `catalog.product_created` domain event.

| Command                                                  | Description                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm dev`                                               | Run api, worker, admin and app in watch mode                    |
| `pnpm build`                                             | Build all apps                                                  |
| `pnpm typecheck`                                         | TypeScript across the workspace                                 |
| `pnpm lint` / `pnpm fmt`                                 | oxlint / oxfmt                                                  |
| `pnpm test`                                              | vitest (critical code only; see CLAUDE.md)                      |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:reset` | Prisma client / new migration / reset                           |
| `pnpm queues:setup`                                      | Install the pg-boss schema and queues (owner role, deploy step) |
| `pnpm db:app-role`                                       | Create/update the non-owner `pas_app` role (RLS applies to it)  |

## Documents

- [`PLAN.md`](./PLAN.md): architecture, bounded contexts, lifecycle state machines, config model, rating, rules, forms, documents, compliance, roadmap, open decisions
- [`docs/landscape.md`](./docs/landscape.md): Duck Creek, Socotra and others, and where we differ
- [`docs/design.md`](./docs/design.md): the design system (look, tokens, components, copy)
- [`CLAUDE.md`](./CLAUDE.md): working agreement for AI agents and contributors

## License

[Functional Source License 1.1, Apache 2.0 future license](./LICENSE). You can use, modify and self-host PAS for your own business. You can't sell or host it as a competing product or service without a commercial license. Each release becomes Apache-2.0 two years after it ships.
