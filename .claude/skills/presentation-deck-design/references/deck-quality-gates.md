# Deck Quality Gates

Run these gates before rendering and again against the final contact sheet.

## Gate 1: Evidence

- Every claim, number, quotation, and proper noun has a source or is marked `未確認`.
- Confirmed facts, stakeholder statements, inference, and open questions are distinguishable.
- No missing source is converted into an assertion.
- Brainbase-managed material has a project code and canonical route for each information type.
- Resolver receipts are used only for routing; actual retrieved entities, documents, or assets support the deck.
- Official names, organizations, people, projects, decisions, and progress match retrieved Graph entities.
- Logos, photos, PDFs, and shared assets retain their exact Drive file IDs or source URLs.
- Personal KG was used only with explicit user authorization and is labeled as judgment, not team fact.
- No-result and retrieval failures remain unresolved rather than being converted into absence or zero.
- Drift-prone facts and assets were refreshed before external delivery.

## Gate 2: Narrative

- The title-only sequence forms a coherent argument.
- Each slide answers one question.
- Each slide has one primary role.
- The audience decision or next action is visible in the arc.

## Gate 3: Intensity

- `強` is approximately 20–30%.
- `中` is approximately 50–60%.
- `静` is approximately 20–30% and at least one slide exists.
- No three `強` slides are consecutive.
- Hero slides are no more than half of the deck.
- Every three-slide run contains at least one no-hero slide.
- A 3–5 slide deck has at least one `静` slide and no more than two `強` slides.

Percentages are targets, not an excuse to misclassify content. The hard sequence and hero limits still apply.

## Gate 4: Layout

- Layout follows the declared information structure.
- Parallel or continuation pages keep a learnable skeleton.
- Layout variation is not produced by rotating arbitrary templates.
- Equal-list, definition, scope, schedule, and appendix pages do not contain a fabricated hero.
- Unlike concepts are not forced into identical cards or equal text lengths solely for symmetry.

## Gate 4.1: Density

- Content volume, reading density, emphasis density, and visual density have been assessed separately.
- Every page has a declared reading-density target and intended visible-unit count.
- Density reduction removes duplication and decoration before removing source facts.
- A strong page normally has one focal unit; a quiet page has no competing focal unit.
- The same fact is not repeated across body copy, callouts, and metric panels.

## Gate 5: Visual System

- The deck declares `brand-led` or `simple-monochrome` before rendering.
- The palette is declared once and copied verbatim to every renderer prompt.
- Surface and point-accent color values differ.
- Quiet pages have no accent-color focal point.
- Gradients are justified by the source design rather than added by default.
- Charts remain distinguishable in grayscale.
- Additional accent hues are justified by meaning or brand, not by category count.
- Filled headers, gradients, arrows, shadows, and badges are not used as default emphasis.
- When `simple-monochrome` is selected, black, white, and gray are the only hues and this rule overrides later styling suggestions.
- In `simple-monochrome`, the latest or decisive chart value uses the darkest tone; other series use lighter gray, line style, direct labels, or hatching.
- In `simple-monochrome`, key table columns and mission/definition areas are emphasized with rules or outline borders rather than colored fills.
- In `simple-monochrome`, equal business categories default to rule-separated text blocks, not three same-sized icon circles.

## Gate 6: Visual Assets

- Every illustration, diagram, chart, photo, screenshot, or icon has an informational purpose.
- Repeated decorative icons are absent.
- A meaningful visual is not omitted from a major narrative peak merely to save effort.
- A quiet page is allowed to use typography, rules, table structure, and whitespace without filler art.
- Every planned semantic icon has an explicit subject, meaning, location, and shared drawing language.
- `Decorative icons are prohibited` has not been expanded into a blanket ban on meaningful icons.
- Shared renderer instructions contain no `no icons`, `no diagrams`, `no illustrations`, `no photographs`, `no screenshots`, or equivalent blanket prohibition that conflicts with a page-level asset plan.
- Decoration control is written narrowly and positively, such as `use only planned evidence-bearing assets`, instead of banning an entire medium deck-wide.
- Every page-level visual asset decision appears verbatim in that page's renderer prompt.

## Gate 7: AI-Slop Rejection

Reject and redesign when any of these are systemic:

- every slide has an oversized title,
- every slide has a hero,
- repeated white cards with soft shadows,
- the same icon treatment on every item,
- three or more same-shaped cards or colored icon circles without an information reason,
- the same fact restated in multiple containers,
- bright accent color spread across titles, rules, icons, and surfaces,
- abstract labels that could fit any company,
- identical bullet length and endings outside a definition or complete-list page,
- a dark footer band or CTA repeated without narrative purpose,
- decorative office photography,
- strong pages are not recognizable in a contact sheet,
- the deck looks complete one page at a time but flat in sequence.
- `simple-monochrome` was selected but a decorative accent hue reappeared,
- color was removed but replaced with unnecessary boxes, shadows, arrow shapes, or duplicated callouts.

## Gate 8: Image-deck production

- The source ledger and page copy were frozen before rendering.
- Pages were generated and versioned one at a time, not as a deck collage.
- Every page was inspected at readable size for Japanese text defects, omissions, invention, and overflow.
- A full-deck contact sheet was inspected after the first pass and after material corrections.
- Failed pages were regenerated selectively without destabilizing accepted pages.
- The final PDF uses only accepted page versions in numeric order.
- Page count, dimensions, order, file size, and the first and last rendered pages were verified.
