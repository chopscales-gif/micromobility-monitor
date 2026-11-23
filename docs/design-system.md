# Console design system

Internal note. How every screen in `apps/web` is drawn after the 2026-11-23 facelift (light, pastel, coral; a top header in place of the sidebar; light maps). The home page (`src/app/page.tsx`), `components/CaseCard.tsx` and `components/Mark.tsx` are the reference implementations: read them before converting a page.

## Direction

Light first, dark as a toggle (`data-theme` on `<html>`, cookie `mm_theme`). Modern and premium, easy to look at, without the machine-made look. Depth comes from raised white sheets with soft layered shadows on a softly graded page, and gentle gradients on surfaces and the primary button. The palette is warm: a peach wash at the top of each page (`--page`), white sheets, coral as the one brand colour (`--color-brand` #ee6a34 for marks and highlights, `--color-signal` #cc4a18 for the primary button, which passes contrast with white text), `--color-tint` and `--color-bar` as its pale steps.

Never: neon accents or glow, a grid of small bordered cards (one card per item), a coloured stripe down the left edge of a card, uppercase letter-spaced mini labels, filled pill badges, monospace for decoration, `font-cond`, arrows (`→`) on links, an explanatory sentence under every heading, big-number tiles in separate boxes, photographs on staff screens.

## Tokens (all in `src/app/globals.css`; never hard-code a hex in a page)

Tailwind colour utilities: `bg-ink` (page), `bg-panel`/`bg-deck` (surface), `bg-raise` (hover, inset wells), `border-line` (hairline), `border-rule` (stronger rule, under headings), `border-control` (input borders, 3:1), `text-text`, `text-dim` (secondary), `text-faint` (captions; smallest allowed emphasis), `signal` (primary button, focus ring), `brand` (wordmark, active tab, the peak bar of a chart), `tint` (selected filter, demo strip), `bar` (resting chart bars), `good`, `fair`, `poor`, `held`, `disputed`, `trip`, `available`, `idle`, `elsewhere`, `removed`, `kestrel`, `pronghorn`, `saltgrass`, `zone-no-parking`, `zone-equity`, `zone-outside`, `paper`/`paper-ink` (the printed invoice).

Colour constants in `lib/*.ts` carry `color` (a `var(--color-*)` string, for the page) and, where a map needs it, `hex` (fixed, for the maps, which are drawn light in both themes). `operatorColor(slug)` returns a var; `operatorHex(slug)` a hex.

Colour is used only for meaning: a status, an operator, a judgement. Links are ink with an underline (`.link`), not coloured. Text on a colour fill is not used except the primary button.

Shadows and gradients: `var(--shadow-sm|md|lg)`, `var(--surface)`. `.panel` and `.btn` already apply them; do not invent new ones.

## Type

Figtree for text and Lexend (`--font-display`) for page titles, section headings and large figures; both soft and round (IBM Plex Sans read as sharp and harsh). 15px base (`body`), tabular numbers everywhere by default. Sizes: 13px (`text-[0.8125rem]`) for captions and secondary lines, 15px body, 17px section headings, 17 to 18px lede, up to 38px page title. Weights: 400, 500 (names, row titles), 600 (headings, the value that matters). No text smaller than 13px except a count badge. Sentence case always.

## Component classes

- `.title` page h1; `.lede` the sentence under it. Use `<PageHead title aside above>` (no eyebrow).
- `.panel` a raised sheet. One per group of like things. Usual padding `px-6 pb-3 pt-5` when it holds a `.heading` and rows; `p-6` for prose or a form.
- `.heading` an h2 on a rule. Inside it: `<small>` for a short grey note, an element with class `aside` (often `aside link`) pushed to the right.
- `.row` one line in a list, a CSS grid; set columns with `grid-cols-[...]`. As a link (`<a class="row">`) it tints on hover. Lists of like things are rows inside one sheet, with fixed column slots so values align down the list. On phones collapse to `grid-cols-[1fr_auto]` and order with `max-md:order-*`.
- `table.grid-table` for true tables: sentence-case grey headers, hairline rows, `.r` right-aligns numbers. Wrap in `overflow-x-auto` inside a `.panel`.
- `.label` a small grey caption over a value or a form field.
- `.status` (or `<Status color>`) a state in words with a dot in its colour. Replaces every pill.
- `<Operator slug name>` / `<OperatorMark slug>` an operator with its mark: colour plus shape (circle, diamond, square).
- `.btn`, `.btn-signal` (one primary action per screen), `.field` (inputs, selects, textareas).
- `.note` a quoted message or aside in a tinted rounded box (no stripe); `.flash` a result message after an action, coloured by setting a text colour class on it.
- `.link` an inline link.
- `.figure` a large number; use sparingly, at most one group per page, inside a single washed band, `.stats` (number first, bold name under it, a short note; divided by hairlines). `.stats-solid` is the opaque variant that overlaps the public hero.

`.eyebrow` and `.pill` survive only as stopgaps: remove every use.

## Layout

Page wrapper: `<main className="mx-auto w-full max-w-[84rem] space-y-8 px-4 py-8 lg:px-8 lg:py-11">`. Two columns where there is a side column: `grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]`. Everything must work at 390px wide with no sideways scroll of the page (tables scroll inside their sheet).

The staff shell is a top header in `app/(console)/layout.tsx`: pale demo strip with the seat picker, a row with the wordmark, the person and the theme toggle, then the sections as tabs (`Nav`, coral underline on the current one; scrolls sideways on a phone). The public side has its own shell in `app/(public)/layout.tsx`, 76rem wide, with no seat. Its page opens on `.hero-photo`: a full-width stock photograph (`public/photos/city-skyline.jpg`, Unsplash, credited as stock in the page footer) under a pale wash, with the month's figures overlapping its foot. Staff screens carry no photographs. `app/layout.tsx` is only the document. Chrome carries `no-print`.

## Writing

Plain sentences, as a city employee would say them. Deadlines as an absolute day ("Reply due Tue, Nov 24"), relative time only as a gloss or for past events. No mention of build phases anywhere. Keep every existing honesty statement ("demonstration", "simulated", "fictional").

## Maps

Any element holding a map canvas, and the controls drawn over it, gets `data-theme="light"` so its tokens resolve to the light values in both themes; the basemap is the pale Protomaps flavour with warm overrides (`components/map/base.ts`). Canvas colours come from the `hex` fields, chosen to read on the pale map; markers carry a white edge. The density ramp is a single coral scale (#fde3d3 to #a8400f), never a status hue.

## Charts

No chart library. `components/charts.tsx` draws with plain boxes: `Columns` (a bar per day or hour, stacked by operator in the operators' own colours, or pale `--color-bar` when there is one series, with its tallest bar in `--color-brand`) and `Bands` (a row per band: name, bar, share, count). Every bar carries its figure as a title, every chart has a table or download with the same numbers, and charts that are compared share one scale. Faint gridlines, rounded bar tops, no axis numbers; a few tick labels under the baseline. A withheld public count is drawn as a gap and written as "withheld".
