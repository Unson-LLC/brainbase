# Deck Plan Template

Complete this before image generation or PowerPoint construction.

## Deck Brief

```markdown
Audience:
Brainbase project code:
Decision or change expected:
Presentation setting and duration:
Center pin:
What the audience already knows:
What must be proven:
Output format:
Required sources:
Unconfirmed inputs:
Existing design source:
Visual mode: brand-led / simple-monochrome
Palette priority: normal / 最優先
Locked palette:
Fonts:
Grid, footer, and page-number rules:
Illustration and icon language:
Shared-prompt exclusions that could conflict with page assets: none / <rewrite required>
Reading-density policy:
File naming and version policy:
```

## Brainbase Source Receipt

Complete this section for Brainbase-managed work before approving the title-only story.

```markdown
Brainbase-managed context: yes / no
Resolver receipt(s):
Actual retrieval receipt(s):
Canonical Graph entity IDs:
Owning repository source paths and revisions:
Team Drive file IDs or URLs:
Personal KG explicitly authorized: yes / no / not applicable
Workspace evidence paths:
Source ledger path:
Material unresolved items:
Pre-delivery refresh required for:
```

## Title-Only Story

```markdown
1. <title>
2. <title>
3. <title>
```

Read this list without body copy. Rewrite it if the argument is not understandable.

## Slide Plan

| No. | Title | Role | Question | Conclusion | Information structure | Intensity | Reading density | Visible units | Hero | Visual asset | Asset function | Icon subjects or `なし` | Layout sentence | Evidence |
|---:|---|---|---|---|---|---|---|---:|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

Allowed values:

- Role: `主張`, `分析`, `情報提示`, `定義・前提`, `付録`
- Intensity: `強`, `中`, `静`
- Reading density: `低`, `中`, `高`
- Visible units: count of independently scanned blocks
- Hero: `数値`, `キーワード`, `図版`, `なし`
- Information structure: `収束`, `対比`, `順序`, `内包`, `分布`, `因果`, `並列列挙`, `時間軸`, `関係`

## Allocation Check

```markdown
Total slides:
強:
中:
静:
Hero slides:
Three 強 in a row: yes/no
Any three-slide run without a no-hero slide: yes/no
Quiet slide with an accent: yes/no
Planned visual asset missing from any renderer prompt: yes/no
Shared negative prompt conflicts with any page asset: yes/no
Duplicated fact in multiple visual containers: yes/no
Mechanically repeated container without information reason: yes/no
Simple-monochrome contains any non-neutral hue: yes/no/not-applicable
Key table column uses fill instead of border: yes/no/not-applicable
Latest or decisive chart value is the darkest tone: yes/no/not-applicable
```

## Renderer Handoff

For each slide, copy the plan row and append:

```markdown
Exact content:
Elements that may be shortened:
Elements that must remain verbatim:
Do not invent:
Citation or source line:
Locked palette copied verbatim:
Visual asset copied verbatim:
Asset function copied verbatim:
Icon subjects, meanings, positions, and drawing language copied verbatim, or `なし`:
Shared-prompt conflict check: pass/fail
Planned reading density and visible-unit count:
Accepted page filename and version:
Page-level QA result:
```

## Production Ledger

```markdown
| No. | Planned file | Generated file | Page QA | Contact-sheet QA | Final PDF source | Notes |
|---:|---|---|---|---|---|---|
| 1 | p01-v1.png |  | pending | pending | no |  |
```
