# Design research: improving the console's look

Internal note, 2026-11-21. Three research passes (dashboard principles, reference products, visual craft) condensed into what applies to this console. Nothing here has been built yet.

## How far to trust this

- Almost none of this has been measured on dashboards. The solid ground is perception science (position and length beat angle and area; about four chunks of working memory), the WCAG contrast rules, and the contrast and colour-distance numbers measured on our own tokens. The rest is expert guideline from Few, Nielsen Norman Group and the published design systems.
- City micromobility vendors hide their screens behind logins. Only Ride Report, Populus (2020 slides), Blue Systems and Via marketing images could be viewed. No vendor shows a public invoice screen, data-health scorecard or escalation ladder, so those designs are ours.
- Colour-blindness figures are from a simulation (Machado 2009), not from tests with people.

## Faults measured in the current tokens (`apps/web/src/app/globals.css`)

| Fault | Number | Rule |
|---|---|---|
| `faint` #6b7783 used as text | 3.67:1 on panel, 3.21:1 on raise | text needs 4.5:1 |
| Input border (`line` on `deck`) | 1.48:1 | control boundary needs 3:1 |
| Disputed vs Kestrel | distance 0.5 under deuteranopia (6+ is workable) | effectively the same colour |
| Held vs Kestrel, held vs disputed | 1.2, 1.6 | same |
| Poor vs accent | 1.4 under tritanopia | red alarm and vermilion brand read alike |
| Heat ramp step 4 | is exactly the accent #ff5a36 | ramp runs through fair, poor and accent hues |
| Invoice paper #f5f2ea in dark UI | about 15:1 jump against the panel | glare; soften to about #ece8dd |

Passing and worth keeping: surface steps (ink, deck, panel, raise), primary and dim text, dark text on the vermilion button, the focus ring, pills at 11px/700. IBM Plex digits are already equal width in the build checked (the served next/font build was not checked).

## Principles that apply, by strength

1. **Loud colour only for what needs action.** Few 2006 pitfalls 10 and 12, Carbon, GOV.UK, Atlassian. Solid fills for overdue, disputed, breached; a dot plus text or plain text for everything else. Carbon: skip the indicator when no action is needed; more than five or six indicator types overwhelms.
2. **A big number needs a comparator.** Few pitfall 2: "Compared to what?" Add a change against last week or a target; a one-colour sparkline where there is a series. A tile that does not change what the person does this morning moves down.
3. **Never colour alone.** WCAG 1.4.1. Status gets colour plus icon shape plus label. Operators get colour plus initials (and a marker shape on the map).
4. **Accent is for interaction; severity has its own hues.** Carbon colour roles, PatternFly. Vermilion on buttons, active nav, focus and the demo banner only; never in data marks.
5. **One level of containment, tonal steps, hairline borders.** NN/g, Atlassian, Linear ("structure should be felt not seen"). Reinecke 2013: perceived visual complexity predicts first-impression appeal more than colour does. This reframes the stored "each thing on its own panel, bold values" rule: keep separation, make it cheaper, and bold only the one or two values per screen that matter.
6. **Lists for like things, cards for unlike things.** NN/g: cards are poor for comparison. The case queue should be rows with fixed column slots; role homes can stay as grouped summaries.
7. **Deadlines show the absolute date with the relative gloss** ("Due Fri 28 Nov, in 2 days"). Relative text goes stale in screenshots and exports.
8. **Empty queue is a success state only if the data is fresh.** Show an "as of" time tied to data health.
9. **History:** date, title, byline, one line, detail collapsed; say which order it is in. DWP found agents on poor screens could not read dim secondary text.
10. **Ladder:** vertical, all rungs shown, completed rungs recede, current rung the only loud one, next rung shows its trigger and date.
11. **Tables:** right-align numbers, sticky header, wrap before truncating. Zebra stripes do not speed anyone up (two null studies) but people like them; a hover highlight has better support.
12. **Motion:** 110 ms for hover and colour, 150 to 240 ms for panels, nothing over 400 ms, no count-up animations, honour reduced motion. The live map needs a pause control (WCAG 2.2.2).

## Patterns from real products worth adopting

- Dashed cap line across the fleet-count chart, breach shaded (Populus, Blue Systems).
- Quantile legend with stated break values and a mode switch on the hex map (Blue Systems); honest count in the tooltip.
- Map pin opens a compact card with the operator's identity band, then "open case" (Ride Report, Via).
- Show how a violation was counted, next to the count. Vianova counts one infringement per hour whether over by 1 or by 100; our evidence already does better and should say so.
- Detail page with "state and next required action" at the top, workflow actions grouped apart from the record (Sentry, incident.io).
- Filters, tabs and the map position kept in the URL (Vercel guidelines, Motive).
- Lifted, desaturated dark basemap so the data carries the colour (Stamen).

Avoid: glass and glow over the map, neon mission-control styling, pie charts and BI-embed look, a rainbow of operator colours, decorative empty-state art, hover-only actions, auto-refreshing lists that move under the cursor.

## Proposed token changes (all contrast-checked on graphite)

| Role | Now | Proposed | Why |
|---|---|---|---|
| Tertiary text | #6b7783 | #8894a0 | 4.74:1 or better on every surface but popovers |
| Control border | #2d3641 | #6b7783 | reaches 3:1 |
| Popover surface | none | #29313b | one step above raise |
| Held | #8fa8ff | #c3ccd6 pale slate | stops colliding with Kestrel and disputed |
| Disputed | #d58cff | #c57ae6 magenta | same |
| Kestrel | #b79cff violet | #8bafff blue | operators at least 8.4 apart |
| Poor (optional) | #ff4d6a | #fb6188 | pulls the alarm away from vermilion |
| Heat ramp | navy to vermilion to yellow | lightness-only slate ramp, #3b444c to #e9eff5 | no hue overlap with status, operator or accent |
| Paper | #f5f2ea | #ece8dd | less glare |

Unchanged: surfaces, primary and dim text, good, fair, Pronghorn, Saltgrass, radii, type families.

Type scale: 11 (caps labels and pills only), 12 meta, 13 tables, 14 body, 16 lead, 20/24 titles, 32/40 key figures. Spacing: 2, 4, 6, 8, 12, 16, 24, 32, 48, 64.

## How these could lose

- Quieter status marks hide a problem if "needs action" is defined wrongly. Check each seat's home after the change.
- Fewer boxes can make dense areas ambiguous, and it runs against a stated preference. Decide on a mockup, not in the abstract.
- The slate heat ramp gives about six readable steps and looks less dramatic than a hot ramp; in a demo that drama may be worth the hue overlap. Compare both.
- A 3:1 input border is heavier and may look less refined.
- The colour-distance numbers are simulated. Small map points are harder to tell apart than chips; shape and initials are the real safeguard.
- Dark-only: lab reading studies favour light for small text, and one chart-reading study found the better polarity varies by person. The public page and print should be light; a staff light theme doubles the colour work.

## Open legal point

The US ADA Title II web rule requires WCAG 2.1 AA of state and local governments (April 2027 for populations of 50,000 or more). The public open-data page is clearly in scope. Whether a staff-only console is covered was not confirmed. For a portfolio demo the useful claim is "built to WCAG 2.2 AA", and only once it is true.

## Main sources

- Few, Common Pitfalls in Dashboard Design (2006): https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf
- Few, Dashboard Design for Real-Time Situation Awareness: https://www.perceptualedge.com/articles/Whitepapers/Dashboard_Design.pdf
- NN/g: https://www.nngroup.com/articles/dashboards-preattentive/ , /data-tables/ , /cards-component/ , /visual-hierarchy-ux-definition/ , /empty-state-interface-design/ , /dark-mode/ , /animation-duration/ , /aesthetic-usability-effect/
- Carbon: https://carbondesignsystem.com/patterns/status-indicator-pattern/ , /data-visualization/dashboards/ , /data-visualization/color-palettes/ , /elements/color/overview/ , /elements/motion/overview/
- PatternFly status and severity: http://www.patternfly.org/patterns/status-and-severity
- GOV.UK tag and table: https://design-system.service.gov.uk/components/tag/ ; DWP timeline notes: https://design-system.dwp.gov.uk/components/timeline/design-notes
- Atlassian elevation: https://atlassian.design/foundations/elevation ; Radix scale: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- Linear: https://linear.app/now/how-we-redesigned-the-linear-ui ; https://linear.app/now/behind-the-latest-design-refresh
- Vercel Web Interface Guidelines: https://vercel.com/design/guidelines ; Stripe colour: https://stripe.com/blog/accessible-color-systems
- incident.io on-call design: https://incident.io/blog/design-details-on-call ; Sentry issue details: https://sentry.io/changelog/new-issue-details-ui-now-available/
- Stamen dark maps: https://stamen.com/stamens-dark-map-materials/ ; Crameri et al. on colour maps: https://pmc.ncbi.nlm.nih.gov/articles/PMC7595127
- WCAG 2.2 understanding docs: https://www.w3.org/WAI/WCAG22/Understanding/ ; ADA rule dates: https://www.ada.gov/resources/web-rule-first-steps/
- Ride Report: https://www.ridereport.com ; Populus 2020 deck: https://stran.senate.ca.gov/sites/stran.senate.ca.gov/files/Populus%20-%20Presentation.pdf ; Blue Systems: https://www.bluesystems.io/bluemobility-manager ; Vianova compliance docs: https://help.vianova.io/docs/understanding-compliance
- Table studies: https://alistapart.com/article/zebrastripingdoesithelp/ ; https://research.adobe.com/publication/web-table-formatting-affects-readability-on-mobile-devices
- Reinecke et al. 2013: https://www.eecs.harvard.edu/~kgajos/papers/2013/reinecke13predicting.shtml
