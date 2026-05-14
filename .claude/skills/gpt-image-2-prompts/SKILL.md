---
name: gpt-image-2-prompts
description: Use EvoLinkAI/awesome-gpt-image-2-prompts as a live reference library for GPT-Image-2 prompt patterns, image examples, UI mockups, poster/ad creatives, portrait/photo styles, character sheets, and comparison cases. Use when drafting, improving, benchmarking, or searching image-generation prompts.
---

# GPT-Image-2 Prompt Reference

Use this skill when the task involves:

- drafting or improving GPT-Image-2 prompts
- finding image prompt inspiration by category
- building visual prompt formulas for UI mockups, posters, ads, portraits, products, characters, or comparison examples
- converting a vague visual request into a structured image-generation brief
- benchmarking a generated image prompt against known community patterns

Primary source:

- Repository: `https://github.com/EvoLinkAI/awesome-gpt-image-2-prompts`
- Observed HEAD when this skill was created: `72cadc33dd85fb1ceb2153e8a25b47ae9cda3e8d`
- Local temp path convention: `/tmp/awesome-gpt-image-2-prompts`

Do not assume the repository is static. When source freshness matters, fetch the current repo before using examples.

## Source Workflow

Fetch or refresh the reference repo:

```bash
rm -rf /tmp/awesome-gpt-image-2-prompts
git clone --depth 1 https://github.com/EvoLinkAI/awesome-gpt-image-2-prompts.git /tmp/awesome-gpt-image-2-prompts
```

Inspect the case index:

```bash
jq '.records | length' /tmp/awesome-gpt-image-2-prompts/data/ingested_tweets.json
jq -r '.records[].category' /tmp/awesome-gpt-image-2-prompts/data/ingested_tweets.json | sort | uniq -c | sort -nr
```

Search by category, title, or creator handle:

```bash
jq -r '
  .records[]
  | select((.category + " " + .title + " " + .author_handle) | test("UI|poster|portrait|product|character"; "i"))
  | [.category, .title, "@" + .author_handle, .case_anchor, .tweet_url]
  | @tsv
' /tmp/awesome-gpt-image-2-prompts/data/ingested_tweets.json | sed -n '1,40p'
```

Open the matching README section rather than copying large blocks:

```bash
cd /tmp/awesome-gpt-image-2-prompts
rg -n "Case 42|landing page|UI|poster|product" README.md README_ja.md
```

Use local output images for visual inspection when helpful:

```bash
find /tmp/awesome-gpt-image-2-prompts/images -path '*ui_case*' -name '*.jpg' | sed -n '1,20p'
```

## Usage Rules

1. Treat the repo as a reference library, not a prompt to paste blindly.
2. Extract reusable structure: subject, composition, medium, lighting, texture, typography, layout, camera/lens, aspect ratio, constraints, and negative requirements.
3. Adapt examples to the user's actual product, brand, audience, and output format.
4. Preserve attribution when citing a specific case: include the GitHub repo and the case title/creator handle if visible.
5. Avoid copying long prompt text verbatim into answers. Summarize patterns and generate a new prompt tailored to the task.
6. For UI mockups, combine this skill with frontend/design skills when implementation quality matters.
7. For product or brand assets, avoid claiming real brand authorization unless the user supplied it.
8. Before redistributing repository content, re-check the current license. The repository README and `LICENSE` may not always present the same license signal.

## Prompt Assembly Pattern

When producing a final prompt, structure it in this order:

```text
Subject and goal:
Visual format:
Composition:
Style and medium:
Lighting and color:
Material/detail cues:
Text/typography rules:
Camera or perspective:
Aspect ratio/output size:
Must include:
Must avoid:
```

For UI mockups, add:

```text
Information architecture:
Interaction/state to show:
Component density:
Device/frame context:
Legibility constraints:
```

For ad/product creatives, add:

```text
Product hero treatment:
Brand mood:
Background/set design:
Callout/label system:
Commercial constraints:
```

## Category Map

At creation time the repo index contained these major buckets:

- `Poster & Illustration Cases`
- `UI & Social Media Mockup Cases`
- `Comparison & Community Examples`
- `Portrait & Photography Cases`
- `Character Design Cases`
- additional lower-case buckets such as `poster`, `portrait`, and `ui`

Use the live JSON index for exact current counts.

## Output Standard

When the user wants a prompt, return:

- a concise rationale for the chosen pattern
- the final prompt
- optional variants if the task benefits from exploration
- source note when a specific case influenced the result

When the user wants research/inspiration, return:

- 5-10 relevant cases with title, category, creator handle, and URL/anchor
- short notes on what pattern each case contributes
- no large verbatim dumps from the repository
