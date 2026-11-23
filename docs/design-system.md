# Console design system

Internal note. How every screen in `apps/web` is drawn after the 2026-11-21 redesign. The home page (`src/app/page.tsx`), `components/CaseCard.tsx` and `components/Mark.tsx` are the reference implementations: read them before converting a page.

## Direction

Light first, dark as a toggle (`data-theme` on `<html>`, cookie `mm_theme`). Modern and premium, easy to look at, without the machine-made look. Depth comes from raised white sheets with soft layered shadows on a softly graded page, and gentle gradients on surfaces and the primary button.

Never: neon accents or glow, a grid of small bordered cards (one card per item), a coloured stripe down the left edge of a card, uppercase letter-spaced mini labels, filled pill badges, monospace for decoration, `font-cond`, arrows (`→`) on links, an explanatory sentence under every heading, big-number tiles in separate boxes.

## Tokens (all in `src/app/globals.css`; never hard-code a hex in a page)

Tailwind colour utilities: `bg-ink` (page), `bg-panel`/`bg-deck` (surface), `bg-raise` (hover, inset wells), `border-line` (hairline), `border-rule` (stronger rule, under headings), `border-control` (input borders, 3:1), `text-text`, `text-dim` (secondary), `text-faint` (captions; smallest allowed emphasis), `signal` (primary button only), `good`, `fair`, `poor`, `held`, `disputed`, `trip`, `available`, `idle`, `elsewhere`, `removed`, `kestrel`, `pronghorn`, `saltgrass`, `zone-no-parking`, `zone-equity`, `zone-outside`, `paper`/`paper-ink` (the printed invoice).

Colour constants in `lib/*.ts` carry `color` (a `var(--color-*)` string, for the page) and, where a map needs it, `hex` (fixed, for the maps, which are drawn dark in both themes). `operatorColor(slug)` returns a var; `operatorHex(slug)` a hex.

Colour is used only for meaning: a status, an operator, a judgement. Links are ink with an underline (`.link`), not coloured. Text on a colour fill is not used except the primary button.

Shadows and gradients: `var(--shadow-sm|md|lg)`, `var(--surface)`. `.panel` and `.btn` already apply them; do not invent new ones.

## Type

Figtree throughout (chosen for its soft, round forms; IBM Plex Sans read as sharp and harsh), 14px base (`body`), tabular numbers everywhere by default. Sizes: 13px (`text-[0.8125rem]`) for captions and secondary lines, 14px body, 15px section headings, 16px lede, 28px page title. Weights: 400, 500 (names, row titles), 600 (headings, the value that matters). No text smaller than 13px except a count badge. Sentence case always.

## Component classes

- `.title` page h1; `.lede` the sentence under it. Use `<PageHead title aside above>` (no eyebrow).
- `.panel` a raised sheet. One per group of like things. Usual padding `px-5 pb-2 pt-4` when it holds a `.heading` and rows; `p-5` for prose or a form.
- `.heading` an h2 on a rule. Inside it: `<small>` for a short grey note, an element with class `aside` (often `aside link`) pushed to the right.
- `.row` one line in a list, a CSS grid; set columns with `grid-cols-[...]`. As a link (`<a class="row">`) it tints on hover. Lists of like things are rows inside one sheet, with fixed column slots so values align down the list. On phones collapse to `grid-cols-[1fr_auto]` and order with `max-md:order-*`.
- `table.grid-table` for true tables: sentence-case grey headers, hairline rows, `.r` right-aligns numbers. Wrap in `overflow-x-auto` inside a `.panel`.
- `.label` a small grey caption over a value or a form field.
- `.status` (or `<Status color>`) a state in words with a dot in its colour. Replaces every pill.
- `<Operator slug name>` / `<OperatorMark slug>` an operator with its mark: colour plus shape (circle, diamond, square).
- `.btn`, `.btn-signal` (one primary action per screen), `.field` (inputs, selects, textareas).
- `.note` a quoted message or aside with a rule down its left; `.flash` a result message after an action, coloured by setting a text colour class on it.
- `.link` an inline link.
- `.figure` a large number; use sparingly, at most one group per page, inside a single sheet divided by hairlines (see `Tiles` on the home page).

`.eyebrow` and `.pill` survive only as stopgaps: remove every use.

## Layout

Page wrapper: `<main className="mx-auto w-full max-w-[84rem] space-y-6 px-4 py-8 lg:px-8">`. Two columns where there is a side column: `grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]`. Everything must work at 390px wide with no sideways scroll of the page (tables scroll inside their sheet).

The staff shell (demo strip, seat picker, left sidebar, theme toggle) is in `app/(console)/layout.tsx`. The public side has its own plainer shell in `app/(public)/layout.tsx`, 72rem wide, with no seat. `app/layout.tsx` is only the document. Chrome carries `no-print`.

## Writing

Plain sentences, as a city employee would say them. Deadlines as an absolute day ("Reply due Tue, Nov 24"), relative time only as a gloss or for past events. No mention of build phases anywhere. Keep every existing honesty statement ("demonstration", "simulated", "fictional").

## Maps

Any element holding a map canvas, and the controls drawn over it, gets `data-theme="dark"` so its tokens resolve to the dark values in both themes. Canvas colours come from the `hex` fields. The density ramp is lightness-only slate (#3b444c to #e9eff5), never the accent or a status hue.

## Charts

No chart library. `components/charts.tsx` draws with plain boxes: `Columns` (a bar per day or hour, stacked by operator in the operators' own colours, or slate `--color-control` when there is one series) and `Bands` (a row per band: name, bar, share, count). Every bar carries its figure as a title, every chart has a table or download with the same numbers, and charts that are compared share one scale. No gridlines, no axis numbers; a few tick labels under the baseline. A withheld public count is drawn as a gap and written as "withheld".
