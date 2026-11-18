import { evaluate } from "@pas/expressions";
import { getAt, isField, type RiskSchema, type SchemaNode } from "@pas/forms-core";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DocumentContext, SelectedCoverage } from "../context";
import { DASH, formatAddress, formatAmount, formatMoney, formatValue } from "../format";
import { createResolver, type Resolver } from "../merge";
import type {
  Block,
  Clause,
  CoverageScheduleBlock,
  DocumentTemplate,
  ExposureTableBlock,
  KeyValueBlock,
  PageSettings,
} from "../model";
import { resolveClause } from "../clauses";
import { parseRichText, type RichBlock, type Run } from "../rich-text";
import { FONT_FAMILY } from "./fonts";

export interface RenderInput {
  template: DocumentTemplate;
  context: DocumentContext;
  clauses: readonly Clause[];
  schema: RiskSchema;
}

const INK = "#18181b";
const BODY = "#3f3f46";
const MUTED = "#71717a";
const RULE = "#e4e4e7";
const RULE_STRONG = "#d4d4d8";

const MARGINS: Record<PageSettings["margins"], number> = { narrow: 36, normal: 54, wide: 72 };

const s = StyleSheet.create({
  page: { fontFamily: FONT_FAMILY, fontSize: 9, color: BODY },
  block: { marginBottom: 18 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brand: { flexDirection: "row", alignItems: "flex-start", gap: 8, maxWidth: "50%" },
  mark: {
    width: 20,
    height: 20,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { color: "#ffffff", fontSize: 10, fontWeight: 600, lineHeight: 1 },
  brandName: { fontSize: 10.5, fontWeight: 600, color: INK, lineHeight: 1.2 },
  brandMeta: { fontSize: 8, color: MUTED, marginTop: 1.5 },
  docTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: INK,
    textAlign: "right",
    lineHeight: 1.2,
    letterSpacing: -0.2,
  },
  docSubtitle: { fontSize: 8.5, color: MUTED, textAlign: "right", marginTop: 3 },
  headerRule: { borderBottomWidth: 0.75, borderBottomColor: RULE_STRONG, marginTop: 14 },
  heading: { fontSize: 12, fontWeight: 600, color: INK, marginBottom: -8, letterSpacing: -0.1 },
  sectionTitle: { fontSize: 9.5, fontWeight: 600, color: INK, marginBottom: 6 },
  paragraph: { marginBottom: 5, fontSize: 9, lineHeight: 1.45 },
  bullet: { flexDirection: "row", marginBottom: 3 },
  bulletMark: { width: 10, color: MUTED },
  bulletText: { flex: 1, fontSize: 9, lineHeight: 1.45 },
  bold: { fontWeight: 600, color: INK },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: "50%",
    paddingVertical: 6,
    paddingRight: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  label: { fontSize: 7.5, color: MUTED, fontWeight: 500, marginBottom: 1 },
  value: { fontSize: 9.5, color: INK, lineHeight: 1.35 },
  pair: {
    flexDirection: "row",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  pairLabel: { width: "34%", color: MUTED, paddingRight: 12 },
  pairValue: { flex: 1, color: INK, fontSize: 9, lineHeight: 1.4 },
  thead: {
    flexDirection: "row",
    paddingBottom: 4,
    borderBottomWidth: 0.75,
    borderBottomColor: RULE_STRONG,
  },
  th: { fontSize: 7.5, fontWeight: 500, color: MUTED },
  tr: {
    flexDirection: "row",
    paddingVertical: 5.5,
    borderBottomWidth: 0.5,
    borderBottomColor: RULE,
  },
  group: { flexDirection: "row", paddingTop: 9, paddingBottom: 3 },
  groupText: { fontSize: 8, fontWeight: 600, color: INK },
  groupMeta: { fontWeight: 400, color: MUTED },
  td: { color: INK, fontSize: 9, lineHeight: 1.4 },
  num: { width: 78, textAlign: "right" },
  idx: { width: 22, color: MUTED },
  total: { flexDirection: "row", paddingTop: 7 },
  totalLabel: { flex: 1, fontWeight: 600, color: INK },
  lead: { fontSize: 9.5, fontWeight: 600, color: INK, lineHeight: 1.9 },
  notice: {
    borderWidth: 0.75,
    borderColor: RULE_STRONG,
    borderRadius: 4,
    paddingTop: 9,
    paddingBottom: 4,
    paddingHorizontal: 12,
    backgroundColor: "#fafafa",
  },
  noticeTitle: { fontWeight: 600, color: INK, marginBottom: 3 },
  signature: { flexDirection: "row", gap: 32, marginTop: 18 },
  signLine: { width: "55%", borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 4 },
  dateLine: { width: "25%", borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 4 },
  footer: {
    position: "absolute",
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: RULE,
    paddingTop: 6,
    fontSize: 7.5,
    color: MUTED,
  },
});

function shows(block: Block, data: Record<string, unknown>): boolean {
  if (!block.showWhen?.trim()) return true;

  try {
    return evaluate(block.showWhen, data) === true;
  } catch {
    return false;
  }
}

function Runs({ runs }: { runs: Run[] }) {
  return runs.map((run, i) =>
    run.bold ? (
      <Text key={i} style={s.bold}>
        {run.text}
      </Text>
    ) : (
      run.text
    ),
  );
}

function RichBlockView({ block, lead }: { block: RichBlock; lead?: string }) {
  if (block.kind === "paragraph") {
    return (
      <Text style={s.paragraph}>
        {lead && <Text style={s.lead}>{`${lead}\n`}</Text>}
        <Runs runs={block.runs} />
      </Text>
    );
  }

  return (
    <View style={s.paragraph}>
      {lead && <Text style={s.lead}>{lead}</Text>}
      {block.items.map((item, j) => (
        <View key={j} style={s.bullet}>
          <Text style={s.bulletMark}>•</Text>
          <Text style={s.bulletText}>
            <Runs runs={item} />
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A `lead` title shares the first paragraph's Text so pagination never strands it. */
function RichText({
  source,
  resolver,
  lead,
}: {
  source: string;
  resolver: Resolver;
  lead?: string;
}) {
  return (
    <View>
      {parseRichText(resolver.merge(source)).map((block, i) => (
        <RichBlockView key={i} block={block} lead={i === 0 ? lead : undefined} />
      ))}
    </View>
  );
}

function SectionTitle({ children }: { children?: string }) {
  if (!children?.trim()) return null;

  return <Text style={s.sectionTitle}>{children}</Text>;
}

function Header({
  title,
  subtitle,
  context,
}: {
  title: string;
  subtitle?: string;
  context: DocumentContext;
}) {
  return (
    <View>
      <View style={s.header}>
        <View style={s.brand}>
          <View style={[s.mark, { backgroundColor: context.tenant.primaryColor }]}>
            <Text style={s.markText}>{context.tenant.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View>
            <Text style={s.brandName}>{context.tenant.name}</Text>
            <Text style={s.brandMeta}>{context.product.name}</Text>
            {context.carrier && (
              <Text style={s.brandMeta}>Underwritten by {context.carrier.name}</Text>
            )}
          </View>
        </View>
        <View style={{ maxWidth: "50%" }}>
          <Text style={s.docTitle}>{title}</Text>
          {subtitle && <Text style={s.docSubtitle}>{subtitle}</Text>}
        </View>
      </View>
      <View style={s.headerRule} />
    </View>
  );
}

function KeyValue({ block, resolver }: { block: KeyValueBlock; resolver: Resolver }) {
  const rows = block.rows.map((row) => ({
    label: row.label,
    value: resolver.merge(row.value).trim() || DASH,
  }));

  return (
    <View>
      <SectionTitle>{block.title}</SectionTitle>
      {block.columns === 2 ? (
        <View style={s.grid}>
          {rows.map((row, i) => (
            <View key={i} style={s.cell} wrap={false}>
              <Text style={s.label}>{row.label}</Text>
              <Text style={s.value}>{row.value}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View>
          {rows.map((row, i) => (
            <View key={i} style={s.pair} wrap={false}>
              <Text style={s.pairLabel}>{row.label}</Text>
              <Text style={s.pairValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function exposureNode(schema: RiskSchema, path: string): SchemaNode | undefined {
  let nodes = schema.fields;
  let found: SchemaNode | undefined;

  for (const key of path.split(".")) {
    found = nodes.find((node) => node.key === key);

    if (!found || found.kind === "group" || found.kind === "repeatable")
      nodes = found?.children ?? [];
  }

  return found;
}

function exposureSummary(node: SchemaNode | undefined, entry: unknown): string {
  if (!node || node.kind !== "repeatable") return "";

  const address = node.children.find((child) => child.kind === "address");

  if (address) {
    const value = getAt(entry, address.key);

    return value && typeof value === "object" ? formatAddress(value) : "";
  }

  const label = node.children.find((child) => isField(child) && child.kind === "text");

  return label ? formatValue(getAt(entry, label.key)) : "";
}

interface CoverageGroup {
  key: string;
  title: string;
  meta: string;
  rows: SelectedCoverage[];
}

function groupCoverages(context: DocumentContext, schema: RiskSchema): CoverageGroup[] {
  const groups = new Map<string, CoverageGroup>();

  for (const coverage of context.coverages) {
    const key = coverage.exposure ? `${coverage.exposure.path}.${coverage.exposure.index}` : "";
    let group = groups.get(key);

    if (!group) {
      if (coverage.exposure) {
        const node = exposureNode(schema, coverage.exposure.path);

        const noun =
          node && "exposure" in node && node.exposure ? node.exposure : (node?.label ?? "");

        const entry = getAt(context.risk, `${coverage.exposure.path}[${coverage.exposure.index}]`);

        group = {
          key,
          title: `${capitalize(noun)} ${coverage.exposure.index + 1}`,
          meta: exposureSummary(node, entry),
          rows: [],
        };
      } else {
        group = { key, title: "Policy", meta: "", rows: [] };
      }

      groups.set(key, group);
    }

    group.rows.push(coverage);
  }

  return [...groups.values()].toSorted((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : 0));
}

function CoverageSchedule({
  block,
  context,
  schema,
}: {
  block: CoverageScheduleBlock;
  context: DocumentContext;
  schema: RiskSchema;
}) {
  const groups = groupCoverages(context, schema);
  const grouped = groups.length > 1;

  return (
    <View>
      <View wrap={false} minPresenceAhead={36}>
        <SectionTitle>{block.title}</SectionTitle>
        <View style={s.thead}>
          <Text style={[s.th, { flex: 1 }]}>Coverage</Text>
          {block.limit && <Text style={[s.th, s.num]}>Limit</Text>}
          {block.deductible && <Text style={[s.th, s.num]}>Deductible</Text>}
          {block.premium && <Text style={[s.th, s.num]}>Premium</Text>}
        </View>
      </View>
      {groups.map((group) => (
        <View key={group.key}>
          {grouped && (
            <View style={s.group} wrap={false}>
              <Text style={s.groupText}>
                {group.title}
                {group.meta && <Text style={s.groupMeta}>{`  ·  ${group.meta}`}</Text>}
              </Text>
            </View>
          )}
          {group.rows.map((row, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={[s.td, { flex: 1 }]}>{row.name}</Text>
              {block.limit && <Text style={[s.td, s.num]}>{formatAmount(row.limit)}</Text>}
              {block.deductible && (
                <Text style={[s.td, s.num]}>{formatAmount(row.deductible)}</Text>
              )}
              {block.premium && (
                <Text style={[s.td, s.num]}>{row.premium ? formatMoney(row.premium) : DASH}</Text>
              )}
            </View>
          ))}
        </View>
      ))}
      {context.coverages.length === 0 && (
        <View style={s.tr}>
          <Text style={{ color: MUTED }}>No coverages selected</Text>
        </View>
      )}
      {block.premium && (
        <View style={s.total} wrap={false}>
          <Text style={s.totalLabel}>Total premium</Text>
          <Text style={[s.num, s.bold]}>
            {context.premium ? formatMoney(context.premium.total) : DASH}
          </Text>
        </View>
      )}
    </View>
  );
}

function ExposureTable({ block, resolver }: { block: ExposureTableBlock; resolver: Resolver }) {
  const entries = resolver.read(`risk.${block.path}`);
  const rows = Array.isArray(entries) ? entries : [];

  return (
    <View>
      <View wrap={false} minPresenceAhead={36}>
        <SectionTitle>{block.title}</SectionTitle>
        <View style={s.thead}>
          <Text style={[s.th, s.idx]}>#</Text>
          {block.columns.map((column, i) => (
            <Text key={i} style={[s.th, { flex: i === 0 ? 2 : 1, paddingRight: 8 }]}>
              {column.label}
            </Text>
          ))}
        </View>
      </View>
      {rows.map((_, index) => (
        <View key={index} style={s.tr} wrap={false}>
          <Text style={s.idx}>{index + 1}</Text>
          {block.columns.map((column, i) => (
            <Text key={i} style={[s.td, { flex: i === 0 ? 2 : 1, paddingRight: 8 }]}>
              {resolver.format(`risk.${block.path}[${index}].${column.path}`) || DASH}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function BlockView({
  block,
  input,
  resolver,
}: {
  block: Block;
  input: RenderInput;
  resolver: Resolver;
}) {
  const { context, clauses, schema } = input;

  switch (block.type) {
    case "header":
      return (
        <Header
          title={resolver.merge(block.title)}
          subtitle={block.subtitle ? resolver.merge(block.subtitle) : undefined}
          context={context}
        />
      );
    case "heading":
      return <Text style={s.heading}>{resolver.merge(block.text)}</Text>;
    case "text":
      return <RichText source={block.body} resolver={resolver} />;
    case "keyValue":
      return <KeyValue block={block} resolver={resolver} />;
    case "coverageSchedule":
      return <CoverageSchedule block={block} context={context} schema={schema} />;
    case "exposureTable":
      return <ExposureTable block={block} resolver={resolver} />;
    case "clause": {
      const clause = clauses.find((candidate) => candidate.key === block.clause);

      if (!clause) return null;

      const resolved = resolveClause(clause, context.policy.jurisdiction);

      return (
        <RichText
          source={resolved.body}
          resolver={resolver}
          lead={resolver.merge(resolved.title)}
        />
      );
    }
    case "formsSchedule":
      return (
        <View>
          <View wrap={false} minPresenceAhead={36}>
            <SectionTitle>{block.title}</SectionTitle>
            <View style={s.thead}>
              <Text style={[s.th, { width: 96 }]}>Form</Text>
              <Text style={[s.th, { width: 56 }]}>Edition</Text>
              <Text style={[s.th, { flex: 1 }]}>Title</Text>
            </View>
          </View>
          {context.forms.map((form, i) => (
            <View key={i} style={s.tr} wrap={false}>
              <Text style={[s.td, { width: 96 }]}>{form.number}</Text>
              <Text style={[s.td, { width: 56 }]}>{form.edition}</Text>
              <Text style={[s.td, { flex: 1 }]}>{form.title}</Text>
            </View>
          ))}
          {context.forms.length === 0 && (
            <View style={s.tr}>
              <Text style={{ color: MUTED }}>No forms in this packet</Text>
            </View>
          )}
        </View>
      );
    case "signature": {
      const name = block.name ? resolver.merge(block.name) : "";

      return (
        <View style={s.signature} wrap={false}>
          <View style={s.signLine}>
            {name && <Text style={s.value}>{name}</Text>}
            <Text style={s.label}>{block.role}</Text>
          </View>
          {block.date && (
            <View style={s.dateLine}>
              <Text style={s.label}>Date</Text>
            </View>
          )}
        </View>
      );
    }
    case "notice":
      return (
        <View style={s.notice} wrap={false}>
          {block.title && <Text style={s.noticeTitle}>{resolver.merge(block.title)}</Text>}
          <RichText source={block.body} resolver={resolver} />
        </View>
      );
    case "pageBreak":
      return <View break />;
  }
}

export function DocumentPdf(input: RenderInput) {
  const { template, context } = input;
  const resolver = createResolver(context, input.schema);
  const margin = MARGINS[template.page.margins];
  const blocks = template.blocks.filter((block) => shows(block, resolver.data));

  return (
    <Document
      title={template.title}
      author={context.tenant.name}
      subject={context.product.name}
      creator={context.tenant.name}
      producer={context.tenant.name}
    >
      <Page
        size={template.page.size === "a4" ? "A4" : "LETTER"}
        style={[
          s.page,
          { paddingTop: margin, paddingHorizontal: margin, paddingBottom: margin + 18 },
        ]}
      >
        {blocks.map((block, i) => {
          const last = i === blocks.length - 1;

          return block.type === "pageBreak" ? (
            <BlockView key={block.id} block={block} input={input} resolver={resolver} />
          ) : (
            <View key={block.id} style={last ? undefined : s.block}>
              <BlockView block={block} input={input} resolver={resolver} />
            </View>
          );
        })}
        <View style={[s.footer, { left: margin, right: margin, bottom: margin / 2 }]} fixed>
          <Text>
            {context.tenant.name} · {template.title}
            {context.policy.number ? ` · ${context.policy.number}` : ""}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
