---
name: presentation-deck-design
description: Design and produce a coherent multi-slide presentation from source analysis through narrative, page roles, visual-intensity and reading-density rhythm, semantic visual planning, one-page-at-a-time image generation, contact-sheet review, targeted regeneration, and final PDF assembly. Use when creating, restructuring, visually directing, or quality-checking a deck, slides, proposal, training material, slide-image sequence, or image-generated presentation. For Brainbase-managed organizations and projects, resolve and retrieve canonical facts, decisions, documents, assets, and authorized judgment before design.
---

# Presentation Deck Design

## Purpose

Own the decisions that must be made across the whole deck before a renderer builds individual pages, then own the deck-level production and validation loop through the final PDF.

This skill is the design director. It does not replace:

- client or project context skills,
- `imagegen` for raster generation,
- `officecli-pptx` for editable PowerPoint production.

Do not start slide generation until the deck plan passes the preflight gates in this skill. For an image-generated deck, follow [references/image-deck-production-loop.md](references/image-deck-production-loop.md) from source ledger through PDF verification.

## Required Inputs

Collect what exists before inventing a structure:

1. Audience, decision, presentation setting, duration, and output format.
2. Source material and evidence. Separate confirmed facts, quoted stakeholder statements, inference, and unknowns.
3. Existing deck, template, brand guide, or prior page images when continuity is requested.
4. Constraints: slide count, required sections, delivery date, editability, speaker notes, citations, accessibility.

If a source is unavailable, label it `未確認`. Do not turn an inaccessible source into an inferred fact.

## Brainbase Source Gate

Apply this gate before the deck brief whenever the request concerns a Brainbase-managed organization, project, person, decision, existing internal document, or Drive asset. Skip it only when the work clearly has no Brainbase-managed context.

1. Identify the project code and split information needs by type: organizational facts, decisions, team documents, original assets, stakeholder judgment, and current workspace state.
2. Use `brainbase-knowledge-resolver` to resolve the canonical route for each type. A resolver receipt selects the route; it is not evidence that the source was retrieved.
3. Retrieve the actual source from the resolved system:
   - Graph: official names, people, organizations, projects, terms, relationships, decisions, and progress.
   - Owning repository: reviewed team rules, structured knowledge, and reusable instructions.
   - Team Drive: source PDFs, logos, photos, large originals, and reviewed shared artifacts.
   - Personal KG: personal preferences or judgment only when the user explicitly authorizes it; never promote it to team fact.
   - Workspace: current file and runtime state only; never treat it as durable organizational knowledge.
4. Record every material claim and asset in a Brainbase source ledger before outline approval. Separate confirmed facts, stakeholder statements, inferences, and unknowns.
5. Preserve exact entity names, source IDs or paths, retrieval time, and verification status. Preserve tool-generated owner-visible audit lines exactly; never invent them.
6. If a source lookup returns no result or fails, record it as unresolved. Do not convert a single no-result receipt into proof of absence.

Do not begin rendering when an unresolved item could materially change the official company name, logo, brand system, proposal premise, important number, or approval status. Never substitute a similar organization or project. Revalidate drift-prone facts and Drive assets immediately before external delivery.

Use [Brainbase Source Contract](references/brainbase-source-contract.md) for routing rules, the source-ledger schema, and stop conditions. Brainbase governs source selection and evidence; the workflow below governs communication and visual production.

## Workflow

### 1. Write the deck brief

State:

- audience,
- decision or change expected after the presentation,
- one-sentence center pin,
- what the audience already knows,
- what must be proven,
- required output and constraints.

### 2. Write the title-only story

List every slide title in order before designing a page.

The titles alone must form a readable argument. Use one title grammar consistently:

- conclusion statements, or
- topic noun phrases.

Do not mix them without a deliberate section-level reason.

### 3. Complete the deck plan

Use [references/deck-plan-template.md](references/deck-plan-template.md).

Every slide must declare:

- `role`,
- `question`,
- `conclusion`,
- `information_structure`,
- `intensity`,
- `reading_density`,
- `visible_units`,
- `hero`,
- `visual_asset`,
- `layout_sentence`,
- `evidence`.

### 4. Assign page roles

Choose exactly one primary role:

| Role | Purpose | Hero policy |
|---|---|---|
| `主張` | State a decision, thesis, or decisive conclusion | One hero allowed |
| `分析` | Explain evidence, comparison, mechanism, or cause | One hero allowed when evidence supports it |
| `情報提示` | Present a complete set, status, scope, or inventory | No forced hero; equal treatment is valid |
| `定義・前提` | Establish terms, assumptions, boundaries, or criteria | No hero |
| `付録` | Preserve supporting detail and traceability | No hero |

If there is no claim worth emphasizing, do not fabricate one. Equal treatment is a correct design decision.

### 5. Allocate visual intensity across the deck

Assign one intensity to every slide:

- `強`: decisive claim, conclusion, number, or turning point. Target 20–30%.
- `中`: normal explanation or analysis. Target 50–60%.
- `静`: definition, scope, complete list, schedule, appendix, or breathing page. Target 20–30%, with at least one slide.

Mandatory gates:

- No three `強` slides in a row.
- Slides with a hero must not exceed half of the deck.
- In any run of three slides, at least one must have no hero.
- For decks of 3–5 slides, include at least one `静` slide and use no more than two `強` slides.
- A cover may be `強`, but it still counts toward the allocation.

Use only one hero mechanism on a slide:

1. scale for a number, keyword, or meaningful visual;
2. isolated position with generous whitespace;
3. one small accent-color use.

Do not use a giant title as the default hero mechanism. Cover and true section dividers are exceptions.

### 6. Derive the layout from the information

Do not rotate through a layout menu.

For each slide:

1. Write the one question the slide answers.
2. Classify the information structure:
   - convergence,
   - contrast,
   - sequence,
   - containment,
   - distribution,
   - causality,
   - parallel list,
   - timeline,
   - relationship.
3. Choose the shortest-reading spatial arrangement for that structure.
4. Describe the arrangement in one sentence before rendering.

Change the skeleton when the information hierarchy or role changes. Use the same skeleton for parallel or continuation pages when that helps the audience retain the reading pattern.

Create variety inside a stable skeleton through:

- left/right visual weight,
- whitespace placement,
- title line count,
- rule lines,
- information density.

### 6.1 Separate content volume from reading density

Do not use `information density` as one vague judgment. Track these separately:

- content volume: facts and conditions that must survive;
- reading density: how many visible units the audience must scan;
- emphasis density: how many elements compete for attention;
- visual density: how many colors, containers, icons, rules, and decorations are present.

Reducing reading or visual density does not authorize deleting source facts. First remove duplicated statements, decorative containers, unnecessary color coding, and repeated labels. Then encode relationships spatially through sequence, contrast, convergence, tables, or whitespace.

Declare `reading_density` as `低`, `中`, or `高` and count the intended `visible_units`. A unit is one independently scanned block such as a paragraph, table row group, diagram node, metric, or action. Strong slides should normally have one focal unit. Quiet slides may contain many exact rows but must have zero competing focal units.

### 7. Lock the visual system once

Select one visual mode before choosing colors:

- `brand-led`: preserve an existing client template or explicit brand system;
- `simple-monochrome`: apply the Fujikururi method when the user requests a simple, non-AI-looking deck, cites the source article, or approves monochrome treatment.

When `simple-monochrome` is selected, its palette constraint overrides every later styling suggestion: use only black, white, and gray, including chart series, table emphasis, rules, surfaces, and icon treatment. Convert non-evidentiary imagery to grayscale or omit it. Do not silently reintroduce blue, cyan, purple, green, or a decorative accent. Record `配色優先順位: 最優先` in the deck plan and in every renderer prompt.

Existing client templates and brand rules take precedence. Extract and record:

- background and surface colors,
- body and muted text colors,
- accent color,
- fonts and weights,
- title position,
- footer and page-number treatment,
- illustration or icon language,
- recurring grid and margins.

When no brand system exists and `brand-led` is selected, prefer:

- a warm off-white background such as `#F7F5F0` or `#FAF8F4`,
- dark neutral body text,
- one slightly muted, ink-like accent,
- low-saturation surface tints.

Declare the locked palette as one exact line:

`背景:<value>／面:<value>／本文:<value>／補足:<value>／アクセント:<value and tone>`

Copy this line verbatim into every image-generation prompt.

For `simple-monochrome`, use this form instead:

`配色優先順位:最優先／背景:#F6F6F4／面:#FFFFFF／本文:#111111／補足:#6B6B6B／強調:#000000／色相アクセント:なし`

Rules:

- Do not reuse the same color value for large surfaces and small emphasis points.
- Surfaces are lighter and less saturated; point accents are darker, denser, and smaller.
- Gradients are off by default unless the existing brand or source deck uses them meaningfully.
- In `brand-led`, charts may use one accent tint series plus gray. Add direct labels, line styles, ordering, or hatching so color is not the only carrier.
- In `simple-monochrome`, distinguish series only through black/gray lightness, direct labels, line style, ordering, or hatching. Use the darkest tone for the latest or decisive value.
- Prefer thin gray rules and borders over filled table headers, colored side columns, and colored panels. Emphasize a decisive column with a heavier black border rather than a fill.

### 8. Plan illustrations, diagrams, icons, and photographs

For every slide choose one:

- authored illustration,
- explanatory diagram,
- chart,
- photograph or screenshot,
- semantic icon set,
- typographic or tabular structure,
- none.

`None` is allowed. Whitespace is not missing content.

Choose one primary visual asset. A semantic icon may appear as a subordinate element inside an explanatory diagram when it labels a real step, action, object, or risk. Record the diagram as the primary asset and document each subordinate icon under the semantic-icon contract; do not misclassify the page as two competing primary assets.

Use a visual only when it communicates at least one of:

- a relationship,
- a process,
- a contrast,
- a physical or organizational scene,
- a memorable metaphor grounded in the content,
- a verifiable artifact.

Do not place the same circular icon above every card. Icons must distinguish real categories, actions, objects, or risks. Decorative icons do not satisfy the visual requirement.

Allocate authored illustrations to actual narrative peaks and transitions. Use restrained line icons on equal-list pages only when the icons improve scanning without creating a false hierarchy.

#### Semantic-icon contract

When `semantic icon set` is selected, record all of the following before rendering:

- the exact concept each icon represents;
- the reading task it improves: category recognition, sequence, comparison, action, object, or risk;
- its location and relative size;
- one shared drawing language for the deck: stroke weight, corner treatment, fill policy, and accent-color policy.

Do not describe this choice only as `icons`. Name the subjects, for example `calendar for start timing`, `compass for theme selection`, and `person with checkmark for assigned responsibility`.

`Decorative icons are prohibited` means only that icons without an informational job are prohibited. It must never suppress a semantic icon set already selected in the slide plan.

#### Shared-prompt conflict guard

Keep shared renderer instructions limited to genuine deck-wide invariants such as canvas, palette, typography, margins, and footer treatment.

Do not put page-specific asset decisions into a shared negative prompt. In particular, never use blanket instructions such as `no icons`, `no diagrams`, `no illustrations`, `no photographs`, `no screenshots`, or `no visual elements` across the whole deck.

When the real intent is to prevent decoration, name that intent positively and narrowly: for example, `use only the planned evidence-bearing visual assets; omit unrelated stock photography and filler art`. A media type may be prohibited at slide level only when that slide's declared `visual_asset` uses another medium and the prohibition cannot suppress evidence or a planned asset elsewhere.

Before rendering each slide, compare the shared instructions with that slide's `visual_asset` decision. The slide-specific asset plan wins whenever a shared sentence could be read as suppressing it. Rewrite the shared sentence before generation rather than relying on the renderer to infer the distinction.

### 9. Remove AI-language fingerprints

Prefer source-specific nouns, numbers, conditions, and stakeholder language.

Unless a source requires them, avoid vague words such as:

- 最適化
- 効率化
- 強化
- 向上
- 実現
- 推進
- 加速
- 変革
- 創出
- シームレス
- 包括的
- 戦略的
- 革新的

Do not add empty English labels such as `Solution`, `Strategy`, or `Vision`.

Definition and complete-list slides may use deliberately parallel wording. On other slides, do not force every bullet to the same length or ending.

### 9.1 Remove AI-design fingerprints

Read [references/anti-ai-design-notes.md](references/anti-ai-design-notes.md) when producing a client-facing or image-generated deck.

Reject the default combination of:

- too many colors, especially multiple similar accent hues without a semantic job;
- three or more same-shaped cards or colored icon circles arranged only for symmetry;
- the same fact repeated in body copy, a callout, and a metric panel;
- gradients, arrows, shadows, badges, or filled headers used as generic emphasis;
- equalized copy lengths that hide real differences between the source items.

Prefer hierarchy from typography, whitespace, thin rules, ordering, position, and restrained tone changes. Preserve semantic icons when they materially improve category recognition, sequence, comparison, action, object, or risk. The test is not `does this slide have icons?`; it is `does each visual reduce the audience's reading work?`.

In `simple-monochrome`, apply the source method literally rather than as a loose mood:

- keep the underlying cover composition if it works, but remove colored gradients and arrow-like overlays;
- use pale-gray labels, thin horizontal rules, and outline boxes for overview pages;
- default equal business categories to rule-separated text blocks instead of three colored icon circles;
- allow unequal copy lengths when the source information is unequal;
- make chart numbers stronger by removing colored decoration and darkening only the latest or decisive value;
- use a plain annotation and a heavy black border, not a colored callout or filled key column, for emphasis.

Read the source examples and the five-part production structure in [references/anti-ai-design-notes.md](references/anti-ai-design-notes.md). Do not describe this mode as merely `restrained color` or `neutrals plus one accent`; that weakens the selected constraint.

### 10. Produce renderer-ready prompts

Every slide prompt or implementation brief must include:

- slide number and title,
- role and intensity,
- question and conclusion,
- information structure,
- hero or `なし`,
- exact layout sentence,
- visual asset and why it informs,
- the locked palette line verbatim,
- typography and existing-template constraints,
- content that must not be invented,
- source or evidence pointer.

If the slide uses semantic icons, the prompt must also name every icon subject, what it denotes, where it appears, and the common icon drawing language. If the slide does not use icons, state the positive visual choice instead, such as `typographic table only because exact comparison is the task`; do not add a blanket icon ban to the shared prompt.

Treat generated slide images as layout drafts when they contain substantial Japanese text. Finalize copy, alignment, citations, and micro-layout in editable PowerPoint unless the user explicitly requests image-only delivery.

### 11. Run the image-deck production loop

For image-only delivery, execute [references/image-deck-production-loop.md](references/image-deck-production-loop.md). The required sequence is:

1. freeze the source ledger, title-only story, page plan, copy, and locked visual system;
2. write one complete renderer prompt per page;
3. generate exactly one page image at a time;
4. inspect each page at readable size for Japanese text defects, omissions, invented content, palette drift, and unplanned visuals;
5. create a contact sheet and inspect the full-deck rhythm at thumbnail size;
6. regenerate only failed pages and repeat both page-level and contact-sheet review;
7. assemble pages in exact order into one PDF;
8. verify page count, dimensions, order, file size, and at least the first and last rendered pages.

Never treat successful image generation as successful deck delivery. The PDF and its verification evidence are separate outputs.

## Preflight Gates

Before rendering, run every check in [references/deck-quality-gates.md](references/deck-quality-gates.md).

Any failure means revise the deck plan, not the page styling.

## Delivery QA

After rendering:

1. Inspect every page individually for readability, overflow, factual accuracy, and visual defects.
2. Create a contact sheet showing the entire deck in order.
3. Compare the contact sheet with the planned role and intensity map.
4. Reject the deck if:
   - every page has the same visual strength,
   - strong pages are not identifiable at thumbnail size,
   - quiet pages still contain accent boxes, oversized titles, or false heroes,
   - the palette drifts,
   - repeated cards or icons replace information structure,
   - illustrations are decorative or contradict the evidence.
5. Compare every rendered page with its planned `visual_asset` field. Reject the page if a planned semantic icon, diagram, chart, photograph, or illustration disappeared because of a shared prompt or generic negative instruction.
6. Compare content volume, reading density, emphasis density, and visual density with the page plan. Reject duplicated information and accidental focal points before deleting facts.
7. Fix failed pages only, then repeat both page-level and deck-level QA.
8. For image-only delivery, assemble and verify the PDF using the production-loop checklist.

## Evaluation

Use [references/evaluation-fixtures.md](references/evaluation-fixtures.md) after changing this skill. A change is not complete unless the fixtures still produce the expected role map, intensity distribution, and anti-pattern rejections.

## Related Skills

- ブランド固有の資料では、対象ブランドのSkillが存在する場合だけ併用する。
- 編集可能なPowerPointが必要な場合は、実行環境で利用可能なPPTX作成Skillを併用する。
