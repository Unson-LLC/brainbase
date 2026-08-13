# Evaluation Fixtures

Use these fixtures to test changes to the skill.

## Fixture A: Five-page AI training proposal

Input structure:

1. Cover
2. Three equal learning goals
3. Transition from tool use to project use
4. Three equal PMO work lanes
5. Outcome-first project launch principle

Expected plan:

| No. | Role | Intensity | Hero |
|---:|---|---|---|
| 1 | 主張 | 強 | 図版またはキーワード |
| 2 | 情報提示 | 静 | なし |
| 3 | 分析 | 中 | なし |
| 4 | 情報提示 | 静 | なし |
| 5 | 主張 | 強 | 図版またはキーワード |

Expected visual behavior:

- Page 2 treats all three goals equally.
- Page 3 may use a transition diagram without turning that diagram into a hero.
- Page 4 uses restrained semantic icons only if they improve scanning.
- Page 5 receives the strongest explanatory illustration or workflow.
- Pages 2–5 do not all repeat a large colored conclusion box.
- The contact sheet shows an intentional strong–quiet–medium–quiet–strong rhythm.

Reject if:

- pages 2 or 4 invent a dominant item,
- every page has a giant title,
- all five pages use the same card grid,
- the palette changes between generated pages,
- decorative icons are added merely to satisfy a visual quota.

## Fixture B: Ten-page operational review

Required content:

- cover,
- scope and definitions,
- current-state data,
- two analyses,
- decision,
- implementation sequence,
- governance responsibilities,
- schedule,
- appendix.

Expected behavior:

- Two or three `強` slides, including the decision.
- At least two `静` slides, including scope/definitions or appendix.
- No three `強` slides in a row.
- Schedule and governance do not receive fabricated heroes.
- Analysis layouts follow the actual data relationship rather than a generic three-card pattern.

## Regression Questions

After editing the skill, answer:

1. Can the plan pass while every page has a hero? Expected: no.
2. Can a complete list be quiet and use no icons? Expected: yes.
3. Can parallel pages reuse the same skeleton? Expected: yes.
4. Can a visual be omitted when it adds no information? Expected: yes.
5. Can a narrative peak omit an explanatory visual solely because text fits? Expected: no.
6. Can an inaccessible source be treated as evidence? Expected: no.
7. Can total source facts remain unchanged while reading and visual density decrease? Expected: yes.
8. Can unlike concepts be put into identical cards solely for symmetry? Expected: no.
9. Can semantic icons remain when each improves a declared reading task? Expected: yes.
10. Can the same fact appear in body copy and a decorative metric panel? Expected: no.
11. Can an image deck be generated as one multi-page collage? Expected: no.
12. Is image generation success sufficient without contact-sheet and PDF verification? Expected: no.
13. Does `simple-monochrome` permit one muted blue accent because it looks tasteful? Expected: no.
14. In `simple-monochrome`, can a key table column be emphasized with a heavy black border instead of a fill? Expected: yes.
15. Should three business categories receive three colored icon circles solely because there are three items? Expected: no.
16. May source items keep unequal paragraph lengths instead of being mechanically equalized? Expected: yes.
17. Should the latest or decisive chart value receive the darkest neutral tone? Expected: yes.
18. For Brainbase-managed work, can design begin before canonical routes and actual sources are retrieved? Expected: no.
19. Can a Brainbase resolver receipt be used as evidence without following the route? Expected: no.
20. Can Personal KG judgment be presented as an organizational fact? Expected: no.
21. Can a failed or empty lookup be converted into `0`, `none`, or proof of absence? Expected: no.

## Fixture C: Eleven-page consulting follow-up as generated images

Input structure:

- client has several possible initiatives;
- the deck must converge on one initial experiment;
- some pages are exact comparison tables;
- some pages explain sequences and role boundaries;
- final delivery is image-only PDF;
- source facts and pricing conditions must remain unchanged.

Expected behavior:

- Source ledger and title-only story are completed before any image generation.
- Importance and reading density are planned separately.
- Exact comparison pages may stay quiet and typographic.
- Sequence and role-boundary pages use semantic visuals when those visuals reduce reading work.
- Each page is generated and versioned separately.
- Japanese text and unplanned visual elements are checked page by page.
- The full 11-page contact sheet shows deliberate strong, medium, and quiet rhythm.
- Only failed pages are regenerated.
- The combined PDF is verified as 11 pages with correct first and last pages.

Reject if:

- facts are deleted merely to create more whitespace;
- every initiative is forced into the same colored card;
- a blanket icon ban suppresses planned semantic visuals;
- the same recommendation is repeated in a body paragraph and accent box;
- the final PDF is delivered without order and page-count verification.

## Fixture D: Brainbase-managed company template

Input structure:

- an existing formal company name, brand rules, logo candidates, Drive references, and stakeholder design preferences;
- a visually similar template from another organization also exists;
- the output must be reusable and later placed in the appropriate shared location.

Expected behavior:

- Set the Brainbase project code and resolve source routes by information type.
- Retrieve the organization, brand, and relevant decisions from Graph.
- Retrieve reusable brand rules from the owning repository and original logos or references from Team Drive.
- Use stakeholder preferences only when Personal KG access is explicitly authorized; otherwise keep them as user-provided statements or unknowns.
- Record all material facts and assets in the Brainbase source ledger.
- Reject the visually similar organization as a substitute unless a canonical source explicitly adopts it.
- Stop before rendering if the legal name, logo provenance, or brand system remains materially unresolved.
- Continue with the normal outline, design-system, page-generation, inspection, contact-sheet, regeneration, and assembly workflow only after the source gate passes.

Reject if:

- a routing receipt is cited as evidence without retrieving the source;
- the similar organization's name, logo, colors, or layout is copied into the target template without canonical support;
- a failed or empty lookup is recorded as `0`, `none`, or proof of absence;
- Personal KG judgment is presented as organizational fact;
- the deck renders before material source conflicts are resolved.
