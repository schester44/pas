import { prismaTx } from "@pas/db";
import { Prisma } from "@pas/db/client";
import type { TenantContext, Transaction } from "@pas/kernel";
import type { SearchHit } from "../domain/hit";
import { escapeLike, type SearchQuery, type SearchType } from "../domain/query";
import type { SearchScope } from "../domain/scope";
import type { SearchIndex } from "../ports/search-index";

type Sql = Prisma.Sql;

interface Row {
  id: string;
  title: string;
  details: (string | null)[];
  status: string | null;
  policy_id: string | null;
}

const NONE = Prisma.sql`false`;

const ADDRESSES = (riskData: Sql) =>
  Prisma.sql`jsonb_path_query(${riskData}, 'strict $.** ? (exists(@.line1))')`;

const ADDRESS_TEXT = Prisma.sql`concat_ws(' ', a->>'line1', a->>'line2', a->>'city', a->>'postalCode')`;

/** Shared match fragments for one classified query; each returns SQL `false` when it can't apply. */
class Matcher {
  constructor(private readonly query: SearchQuery) {}

  private get contains() {
    return this.query.kind === "text" ? `%${escapeLike(this.query.text)}%` : null;
  }

  private get startsWith() {
    return this.query.kind === "text" ? `${escapeLike(this.query.text)}%` : null;
  }

  private get serial() {
    if (this.query.kind === "text") return null;

    return this.query.digits.replace(/^0+/, "");
  }

  number(column: Sql, prefix: string): Sql {
    const q = this.query;

    if (q.kind === "text") return Prisma.sql`${column} ilike ${this.contains}`;

    if (q.kind === "number" && q.prefix !== prefix) return NONE;

    const exact = q.kind === "number" ? `${prefix}-${escapeLike(q.digits)}%` : null;
    const serial = this.serial;

    const bySerial = serial
      ? Prisma.sql`ltrim(split_part(${column}, '-', 2), '0') like ${`${escapeLike(serial)}%`}`
      : NONE;

    return exact ? Prisma.sql`(${column} ilike ${exact} or ${bySerial})` : bySerial;
  }

  numberRank(column: Sql): Sql {
    const serial = this.serial;

    if (!serial) return Prisma.sql`0::int`;

    return Prisma.sql`case when ltrim(split_part(${column}, '-', 2), '0') = ${serial} then 0 else 1 end`;
  }

  text(column: Sql): Sql {
    return this.contains ? Prisma.sql`${column} ilike ${this.contains}` : NONE;
  }

  textRank(column: Sql): Sql {
    return this.startsWith
      ? Prisma.sql`case when ${column} ilike ${this.startsWith} then 0 else 1 end`
      : Prisma.sql`0::int`;
  }

  anyText(array: Sql): Sql {
    return this.contains
      ? Prisma.sql`exists (select 1 from unnest(${array}) k where k ilike ${this.contains})`
      : NONE;
  }

  anyDigits(array: Sql): Sql {
    return this.query.kind === "digits" && this.query.digits.length >= 3
      ? Prisma.sql`exists (select 1 from unnest(${array}) k where k like ${`%${this.query.digits}%`})`
      : NONE;
  }

  address(riskData: Sql): Sql {
    return this.contains
      ? Prisma.sql`exists (select 1 from ${ADDRESSES(riskData)} a where ${ADDRESS_TEXT} ilike ${this.contains})`
      : NONE;
  }

  matchedAddress(riskData: Sql): Sql {
    return this.contains
      ? Prisma.sql`(select concat_ws(', ', a->>'line1', a->>'city') from ${ADDRESSES(riskData)} a where ${ADDRESS_TEXT} ilike ${this.contains} limit 1)`
      : Prisma.sql`null::text`;
  }

  mailingAddress(address: Sql): Sql {
    return this.contains
      ? Prisma.sql`concat_ws(' ', ${address}->>'line1', ${address}->>'line2', ${address}->>'city', ${address}->>'postalCode') ilike ${this.contains}`
      : NONE;
  }
}

const producerFilter = (scope: SearchScope, column: Sql) =>
  scope.kind === "producer" ? Prisma.sql`and ${column} = ${scope.producerId}` : Prisma.empty;

type Builder = (m: Matcher, ctx: TenantContext, scope: SearchScope, limit: number) => Sql | null;

const policies: Builder = (m, ctx, scope, limit) => Prisma.sql`
  select p.id, p.number as title,
    array[p.insured_name, p.product_name, ${m.matchedAddress(Prisma.sql`s.risk_data`)}] as details,
    lower(t.status::text) as status, p.id as policy_id
  from policies p
  left join submissions s on s.tenant_id = p.tenant_id and s.id = p.source_submission_id
  left join lateral (
    select status from policy_terms t
    where t.tenant_id = p.tenant_id and t.policy_id = p.id
    order by t.term_number desc limit 1
  ) t on true
  where p.tenant_id = ${ctx.tenantId} ${producerFilter(scope, Prisma.sql`p.producer_id`)}
    and (${m.number(Prisma.sql`p.number`, "POL")} or ${m.text(Prisma.sql`p.insured_name`)}
      or ${m.address(Prisma.sql`s.risk_data`)})
  order by ${m.numberRank(Prisma.sql`p.number`)}, ${m.textRank(Prisma.sql`p.insured_name`)}, p.created_at desc
  limit ${limit}`;

const submissions: Builder = (m, ctx, scope, limit) => Prisma.sql`
  select s.id, s.number as title,
    array[s.insured_name, pr.name, ${m.matchedAddress(Prisma.sql`s.risk_data`)}] as details,
    coalesce(lower(q.status::text), lower(s.status::text)) as status, q.policy_id
  from submissions s
  left join products pr on pr.tenant_id = s.tenant_id and pr.id = s.product_id
  left join quotes q on q.tenant_id = s.tenant_id and q.submission_id = s.id
  where s.tenant_id = ${ctx.tenantId} ${producerFilter(scope, Prisma.sql`s.producer_id`)}
    and (${m.number(Prisma.sql`s.number`, "SUB")} or ${m.text(Prisma.sql`s.insured_name`)}
      or ${m.address(Prisma.sql`s.risk_data`)})
  order by ${m.numberRank(Prisma.sql`s.number`)}, ${m.textRank(Prisma.sql`coalesce(s.insured_name, '')`)}, s.updated_at desc
  limit ${limit}`;

const invoices: Builder = (m, ctx, scope, limit) => Prisma.sql`
  select i.id, i.number as title, array[i.policy_number, p.insured_name] as details,
    lower(i.status::text) as status, i.policy_id
  from invoices i
  join policies p on p.tenant_id = i.tenant_id and p.id = i.policy_id
  where i.tenant_id = ${ctx.tenantId} ${producerFilter(scope, Prisma.sql`p.producer_id`)}
    and (${m.number(Prisma.sql`i.number`, "INV")} or ${m.number(Prisma.sql`i.policy_number`, "POL")})
  order by ${m.numberRank(Prisma.sql`i.number`)}, i.created_at desc
  limit ${limit}`;

const clients: Builder = (m, ctx, scope, limit) => Prisma.sql`
  select c.id, c.display_name as title,
    array[c.email_keys[1], concat_ws(', ', c.mailing_address->>'line1', c.mailing_address->>'city')] as details,
    null::text as status, latest.policy_id
  from client_accounts c
  left join lateral (
    select pp.policy_id from policy_parties pp
    join policies p on p.tenant_id = pp.tenant_id and p.id = pp.policy_id
    where pp.tenant_id = c.tenant_id and pp.client_account_id = c.id
      ${producerFilter(scope, Prisma.sql`p.producer_id`)}
    order by p.created_at desc limit 1
  ) latest on true
  where c.tenant_id = ${ctx.tenantId} and c.status = 'active'
    ${scope.kind === "producer" ? Prisma.sql`and latest.policy_id is not null` : Prisma.empty}
    and (${m.text(Prisma.sql`c.display_name`)} or ${m.anyText(Prisma.sql`c.email_keys`)}
      or ${m.anyDigits(Prisma.sql`c.phone_keys`)} or ${m.mailingAddress(Prisma.sql`c.mailing_address`)})
  order by ${m.textRank(Prisma.sql`c.display_name`)}, c.display_name, c.created_at desc
  limit ${limit}`;

const products: Builder = (m, ctx, scope, limit) =>
  scope.kind === "producer"
    ? null
    : Prisma.sql`
  select pr.id, pr.name as title, array[pr.key, pr.line_of_business] as details,
    lower(pr.status::text) as status, null::uuid as policy_id
  from products pr
  where pr.tenant_id = ${ctx.tenantId}
    and (${m.text(Prisma.sql`pr.name`)} or ${m.text(Prisma.sql`pr.key`)})
  order by ${m.textRank(Prisma.sql`pr.name`)}, pr.name
  limit ${limit}`;

const members: Builder = (m, ctx, scope, limit) =>
  scope.kind === "producer"
    ? null
    : Prisma.sql`
  select u.id, u.name as title, array[u.email] as details, mb.role as status, null::uuid as policy_id
  from members mb
  join users u on u.id = mb.user_id
  where mb.organization_id = ${ctx.tenantId}
    and (${m.text(Prisma.sql`u.name`)} or ${m.text(Prisma.sql`u.email`)})
  order by ${m.textRank(Prisma.sql`u.name`)}, u.name
  limit ${limit}`;

const BUILDERS: Record<SearchType, Builder> = {
  client: clients,
  policy: policies,
  submission: submissions,
  invoice: invoices,
  product: products,
  member: members,
};

/** Read-only queries over the source tables until a search projection exists (PLAN §14). */
export class PostgresSearchIndex implements SearchIndex {
  async search(
    tx: Transaction,
    ctx: TenantContext,
    scope: SearchScope,
    query: SearchQuery,
    type: SearchType,
    limit: number,
  ): Promise<SearchHit[]> {
    const sql = BUILDERS[type](new Matcher(query), ctx, scope, limit);

    if (!sql) return [];

    const rows = await prismaTx(tx).$queryRaw<Row[]>(sql);

    return rows.map((row) => ({
      type,
      id: row.id,
      title: row.title,
      details: row.details.filter((d): d is string => Boolean(d)),
      status: row.status,
      policyId: row.policy_id,
    }));
  }
}
