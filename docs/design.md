# PAS design system

How `apps/admin` and `apps/app` should look and read. Follow it for every UI change. The shared tokens live in
`packages/ui/src/tokens.css` and the components in `packages/ui/src/components`. Change a token there, never in an app.

The bar is Stripe, Linear, Airbnb and Apple: calm, crisp, obviously considered. No vibe-coded UI. That means no
gradient soup, no shadow stacks, no emoji, no wall of pills and no "AI dashboard" filler. If a screen looks busy, it is
wrong.

## 1. The aesthetic

White cards on a faintly cool canvas, edged by hairlines rather than shadows. Hierarchy comes from type size and
weight, not colour: near-black titles, muted secondary text and generous whitespace. There is **one accent**, the
indigo `primary`, and it marks the one thing that matters in an area (the primary button, the active nav item, the
selected row, an icon tile). Amber, red and green are small signals (a dot, a chip, a one-line callout), never
decoration. A soft accent gradient is a highlight, used at most once per page.

Insurance software is dense. Dense is fine; cluttered is not. Achieve density with tight, consistent rhythm, tabular
numbers and quiet table chrome, not by shrinking type or removing whitespace between groups.

## 2. Foundations

### Colour

| Token / class                   | Value                    | Use                                                                    |
| ------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `bg-canvas`                     | `oklch(0.985 0.002 286)` | The shell behind pages (set by `AppShell`). Don't set it yourself.     |
| `bg-card`, `bg-background`      | white                    | Cards, dialogs, controls, the sticky page header.                      |
| `border`                        | `oklch(0.925 0.004 286)` | Every hairline. The base layer applies it, so plain `border` is right. |
| `text-foreground`               | `oklch(0.2 0 0)`         | Titles, values, body text that matters.                                |
| `text-muted-foreground`         | `oklch(0.55 0 0)`        | Descriptions, meta, column headers, empty states.                      |
| `bg-muted`, `bg-muted/40`–`/60` | `oklch(0.96 0 0)`        | Panel footers, table header band, neutral chips, inline sub-forms.     |
| `primary`                       | `#656ae5`                | The single accent.                                                     |
| `destructive`                   | red                      | Destructive buttons and field errors only.                             |

- Accent tints are opacity steps of `primary`: `bg-primary/5` (selected row), `bg-primary/10` (icon tile),
  `ring-primary/15` (tinted edge).
- Status colours are Tailwind's emerald, amber and red at 50/200/500/800–900, for small signals only.
- Never raw greys (`text-gray-500`) or `opacity-50` text. Use the tokens.
- In `apps/app`, a tenant's brand colour replaces `--primary` at runtime. Always use `primary`, never a literal indigo.

### Type

Inter Variable everywhere with `cv11`/`ss01` (single-storey a, open digits). **`tabular-nums` on every amount, date,
count, premium, limit and policy number.**

| Role                  | Classes                                                        |
| --------------------- | -------------------------------------------------------------- |
| Page title            | `<h1>` in `PageHeader` (`text-lg font-semibold`)               |
| Auth / hero title     | `text-2xl leading-tight font-semibold tracking-tight`          |
| Section / card title  | `text-base leading-6 font-semibold`                            |
| Row / item title      | `text-sm leading-5 font-medium`                                |
| Body and descriptions | `text-sm text-muted-foreground`                                |
| Meta                  | `text-xs text-muted-foreground`                                |
| Big number            | `text-3xl leading-9 font-semibold tracking-tight tabular-nums` |

Weights: `font-semibold` for titles and the figure that matters; `font-medium` for row titles, labels and links;
regular for everything else. No `font-bold`.

### Spacing, radius, shadow

- 4/8px rhythm with `gap-*`, not sibling margins. `gap-1` title→description, `gap-3` icon→text, `gap-4` fields in a
  dense form, `gap-6` cards on a page, `gap-8` page sections.
- Cards pad with `--card-p` (16px phone, 24px from `sm`): use `p-(--card-p)`, never hard-coded padding.
- Content widths: `max-w-4xl` for forms and settings, `max-w-6xl` for tables, full width only for work queues.
- Radius: cards `rounded-xl`; tiles, callouts, list items in a card `rounded-lg`; buttons and inputs `rounded-md`;
  chips, dots, avatars `rounded-full`.
- Shadow: cards get `shadow-(--card-shadow)` (1px contact, 4%) from `Card`. Controls `shadow-xs`. Never
  `shadow-md`/`shadow-lg` on in-page surfaces.

## 3. Components and patterns

Use these from `@pas/ui`; don't rebuild them per page.

- **`AppShell`**: sidebar on the canvas, the page on a white inset. Nav items are icon + label, active item
  `bg-card text-foreground shadow-xs ring-1 ring-border`, never a coloured block.
- **`PageHeader`**: the 56px sticky header with the page `<h1>` left and page actions right. One `<h1>` per page; never
  repeat it as a card title.
- **`Card` / `Panel`**: `Panel` is a titled card (title, optional description and action, `border-b`, content,
  optional `footer` on `bg-muted/50`). `Panel flush` for tables and settings rows.
- **Tables**: in `Panel flush`. Header `h-10 text-xs font-medium text-muted-foreground bg-muted/40`, rows 52px, first and
  last cells inset to `--card-p`. Money right-aligned and `tabular-nums`; zero is a muted dash. Rows that open something
  are fully clickable with a hover tint. Below `lg`, wide tables become card lists; never scroll a table sideways.
- **`StatusChip`**: a dot and a word, tones `success | warning | danger | neutral | accent`. Only for state you scan down
  a column (quote status, term status, obligation status). Plain muted text when nothing needs attention.
- **`EmptyState`**: small and centred inside the card that would hold the data, one plain sentence, at most one action.
- **`Notice`**: a titled one-sentence message (failed request, sandbox clock is shifted).
- **Callouts**: one line, a dot, an action. Never a tinted card for status.
- **Dialogs**: for creating a thing with a few fields. Anything longer is a page.
- **Forms**: labels above controls, sentence case, no colons or asterisks (mark _optional_ fields instead). Errors
  inline under the field after first submit; a failed request goes in a `Notice` above the submit. The busy state is a
  spinner in the submit button. Config editors always show a live preview.
- **Buttons**: one primary per area. Outline for secondary and row actions, ghost for tertiary, link for inline. Text
  only unless an icon adds meaning (arrow to go elsewhere, copy, plus for "New"). Labels are verbs: "Create product",
  "Bind quote", "Issue endorsement".
- **Accent surface** (at most once per page): `border-primary/15 bg-linear-to-br from-primary/[0.06] via-card to-card`,
  for onboarding/setup and auth only.
- **Explanations**: wherever the system made a decision (referral, decline, premium change, notice date), show a
  "Why?" affordance that opens the trace in a sheet. This is a signature of the product; design it well.
- **Keyboard**: `⌘K` command palette for navigation and actions, `/` focuses search, `Esc` closes. Tables support
  arrow-key navigation in work queues.

## 4. Copy

- **Sentence case** everywhere: titles, buttons, tabs, labels, chips.
- **Short and plain.** One sentence per description. Say what it does.
- No exclamation marks, no emoji, no uppercase eyebrow labels, no fake social proof, no vendor names in selling copy.
- Insurance words are precise. Use the domain language from PLAN.md (submission, quote, term, endorsement, cancellation,
  reinstatement) and the tenant's own labels from config where they exist.
- Errors say what happened and what to do next: "Couldn't bind. The quote expired on Mar 3; requote to continue."
- Money through the formatter with its currency; date ranges with an en dash ("Jan 1 – Dec 31, 2027").

## 5. Don'ts

- Duplicate titles, stacked padding (gutter → wrapper → card), wrapping button rows.
- More than one primary button per area, or more than one accent surface per page.
- Coloured surfaces for status, heavy shadows, raw greys, `opacity-50` text.
- Icons on every button, pills on every piece of metadata, centred headlines inside the app.
- Spinners for data already in the cache, layout shift while loading (use skeletons that match the final layout).
- Explanatory footer text that restates the screen.
