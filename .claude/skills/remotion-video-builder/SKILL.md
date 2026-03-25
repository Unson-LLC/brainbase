---
name: remotion-video-builder
description: Build, explain, and demo videos with Remotion. Use when Codex needs to set up Remotion in a JavaScript/TypeScript project, design a short live demo, create or edit compositions, wire props-driven video scenes, or render MP4/GIF output for product demos, social clips, explainers, or animated slides.
---

# Remotion Video Builder

## Overview

Use this skill to keep Remotion work practical: choose a demo angle, scaffold a minimal composition, drive the video from props, and render a short result quickly. Prefer a small, legible composition over a flashy but fragile build.

## Workflow

1. Confirm the goal.
2. Choose a demo shape that can be understood in under 30 seconds.
3. Set up Remotion or inspect the existing setup.
4. Build one composition with hardcoded data first.
5. Convert the composition to props-driven content.
6. Render once locally, then optimize only if needed.

## Pick The Right Demo

Prefer demos that show one clear business value:

- Turn text into a branded announcement video.
- Turn structured data into a KPI or timeline video.
- Turn one product message into multiple short social variants.

For a live session, default to this structure:

1. Show the final rendered video first.
2. Reveal that the scene is plain React code.
3. Change text, colors, or timing live.
4. Re-render and compare before/after.

Avoid showing too many advanced features at once. Motion graphics are less persuasive than "edit code -> render video -> ship variant in minutes".

## Setup Checklist

When Remotion is not installed yet:

1. Check the package manager from `package.json` or lockfiles.
2. Install the official Remotion packages that fit the app structure.
3. Keep the first demo isolated in a small directory or app.
4. Use TypeScript if the repo already uses it.
5. Render a tiny composition before expanding scope.

If the user only needs a proof of concept, prefer a minimal Remotion app over integrating deeply into a large existing product.

## Composition Pattern

Use this baseline pattern:

- `Root` registers one or two compositions.
- One composition owns duration, fps, width, and height.
- Scene components receive plain props.
- Animation logic stays near the component that owns the element.
- Data shaping happens before rendering, not inside animation expressions.

Strong defaults for a first demo:

- Duration: 8 to 20 seconds
- FPS: 30
- Format: 1080x1080 or 1920x1080
- Scenes: 3 or fewer
- Dynamic inputs: title, subtitle, accent color, CTA

## Live Demo Script

Use the checklist in [references/demo-checklist.md](references/demo-checklist.md) when the user asks for a talk track or demo runbook.

Recommended live flow:

1. Start with a finished 10 to 15 second clip.
2. Explain that Remotion uses React components to generate video.
3. Open the composition and point out `AbsoluteFill`, timing, and props.
4. Replace the headline and brand color live.
5. Add one scene or duplicate one variant.
6. Render and show the updated result.
7. Close by explaining where this is useful in business terms.

## Rendering Guidance

During setup, favor reliability over speed:

- Render a short clip first.
- Keep fonts, assets, and audio paths local and predictable.
- Avoid introducing remote dependencies unless necessary.
- If rendering fails, reduce the composition to the smallest reproducible scene.

Use CLI or project scripts when they already exist. If not, add the smallest set of commands needed to preview and render.

## Common Requests

Translate vague requests into concrete output:

- "Show Remotion" -> create one short composition and one rendered sample.
- "Make it business-ready" -> use props for copy, colors, and logo slots.
- "Can we template this?" -> move content into JSON or typed props.
- "Can we scale variants?" -> duplicate compositions only after the props contract is stable.

## References

- Live demo checklist: [references/demo-checklist.md](references/demo-checklist.md)
- Quick command patterns: [references/quickstart.md](references/quickstart.md)
