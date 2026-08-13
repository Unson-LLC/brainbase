# Image Deck Production Loop

Use this workflow when the final presentation is produced as generated page images and a combined PDF.

## Contents

1. Artifact contract
2. Stabilize content
3. Plan the deck rhythm
4. Write page prompts
5. Generate one page at a time
6. Inspect each page
7. Inspect the contact sheet
8. Correct selectively
9. Assemble and verify the PDF
10. Place the deliverable

## Artifact contract

Produce and retain:

1. source ledger with facts, quotations, inferences, and unknowns separated;
2. deck plan containing the title-only story, roles, intensity, reading density, visible units, layout, and evidence;
3. one renderer prompt per page;
4. numbered page images with stable zero-padded filenames;
5. at least one full-deck contact sheet;
6. final ordered PDF;
7. verification record for page count, dimensions, order, and visible defects.

Do not overwrite an accepted page while exploring a revision. Give revised pages a new version suffix, inspect them, and promote only the accepted version into the final page list.

## Phase 1: Stabilize content

Create a page-level content ledger before visual production.

For every page record:

- one audience question;
- one conclusion;
- exact facts and conditions that must survive;
- wording that must remain verbatim;
- wording that may be shortened;
- facts that must not be invented;
- source pointer;
- intended visible-unit count.

Do not compensate for an unsettled argument with visual polish.

## Phase 2: Plan the deck rhythm

Complete the deck plan and quality gates.

- Separate importance (`強・中・静`) from reading density (`低・中・高`).
- Make narrative peaks identifiable at contact-sheet scale.
- Keep at least one quiet page.
- Decide which pages use diagrams, semantic icons, tables, typography, or no visual asset.
- Lock palette, typography, margins, footer, illustration language, and icon language once.
- Declare `brand-led` or `simple-monochrome`; for the latter, copy the black/white/gray priority rule verbatim into every page prompt.
- Check shared prompt text against every page asset before generating.

## Phase 3: Write page prompts

Write one self-contained prompt per page. Include the page number, exact copy, role, intensity, reading density, information structure, layout sentence, planned visual asset, asset function, semantic icon subjects, locked palette, and non-invention rules.

Keep deck-wide instructions limited to genuine invariants. Do not use a shared media ban such as `no icons` or `no diagrams`.

When preventing generic AI styling, write narrow positive constraints:

- use only evidence-bearing visuals selected in the page plan;
- omit unrelated stock imagery and filler decoration;
- do not repeat the same fact in multiple visual containers;
- do not create symmetric cards merely to fill space;
- preserve unequal information lengths when the source is unequal.

For `simple-monochrome`, also require:

- black, white, and gray only, with no accent hue;
- thin rules or outline borders before filled cells and panels;
- the darkest neutral only for the latest or decisive value;
- no colored gradient, decorative arrow overlay, three-circle icon row, or multicolor metric panel.

## Phase 4: Generate one page at a time

Generate one numbered page per request. Never ask a renderer to create the whole deck as one collage or one multi-page image.

One-page generation:

- isolates failures;
- forces the renderer to read the exact page copy again;
- permits page-specific visual assets;
- lets accepted pages remain stable while failed pages are corrected.

Use stable filenames such as `p01-v1.png`, `p02-v1.png`, and so on. A revision changes only the version suffix.

## Phase 5: Inspect each page

Open every page at readable size. Check:

- Japanese character corruption, misspelling, or unintended English;
- source facts, amounts, names, dates, and conditions;
- omitted or invented content;
- text clipping, overflow, weak contrast, and awkward line breaks;
- unplanned icons, badges, arrows, trophies, or accent boxes;
- missing planned semantic icons, diagrams, charts, or relationships;
- palette, type, margin, and footer consistency;
- mismatch between planned and actual reading density.

Reject a page for a concrete reason. Record the smallest correction and regenerate that page only.

## Phase 6: Inspect the contact sheet

Create a contact sheet in page order after the first full pass and after material corrections.

At thumbnail size verify:

- strong pages are recognizable;
- quiet pages remain quiet;
- no three pages create the same visual beat;
- palette and margins do not drift;
- the same card or icon system is not repeated mechanically;
- dense pages are followed by relief where the story allows it;
- the cover and final page belong to the same visual system;
- no page becomes dominant because of an accidental accent.

Page-level correctness does not prove deck-level rhythm. Both inspections are mandatory.

## Phase 7: Correct selectively

Regenerate only pages that fail. Preserve accepted pages.

Common correction types:

- text defect: keep composition and rewrite exact text;
- unwanted decoration: name the specific element to remove;
- missing semantic visual: restate its subject, meaning, position, and drawing language;
- false hero: remove accent or scale without flattening the whole page;
- excessive density: remove duplication and containers before removing facts;
- weak density: group related facts spatially before adding decoration.

Rebuild the contact sheet after replacements.

## Phase 8: Assemble and verify the PDF

Assemble only the accepted page versions in exact numeric order.

Verify:

- expected page count;
- consistent page dimensions and orientation;
- correct page order;
- nonzero and plausible file size;
- successful rendering of the first and last pages;
- no stale page version entered the PDF.

Keep the plan, page images, contact sheet, and final PDF together until delivery is confirmed.

## Phase 9: Place the deliverable

Drive or repository placement is a separate authority decision. Use the relevant project and Drive-structure skill, verify the current destination live, upload the final PDF, and read back the file name, identifier, parent, type, size, and link. Do not infer successful placement from a local copy alone.
