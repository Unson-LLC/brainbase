# VibePro Development Run: command-center redesign

## Request

VibeProを使って修正をかけて。

## Goal

Accepted command-center component sheetを基準に、既存レイアウトは置き換えず、Brainbase UIの実コンポーネントをgraphite/cobalt基調へ寄せる。既存のVS Code風・紺色寄りの見え方を抑え、サイドバー、コマンドレール、右ドロワー、タイムライン、タスク、フォーム部品を同じデザイン言語に揃える。

## Changed Surface

- `public/index.html`
- `public/style.css`
- `public/modules/ui/views/nocodb-tasks-view.js`
- `package.json`
- `scripts/vibepro-component-style-check.mjs`
- `docs/design/brainbase-command-center-component-sheet-2026-05-07.png`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign/component-style-check.json`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign/component-style-desktop.png`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-101513-command-center-redesign/component-style-mobile.png`

## Verification

- `git diff --check -- public/style.css public/index.html public/modules/ui/views/nocodb-tasks-view.js`
- `npm run typecheck`
- `npx eslint public/modules/ui/views/nocodb-tasks-view.js`
- `npm run vibepro:component-style`
- `var/design-check-brainbase-command-center.png`
- `var/design-check-brainbase-command-center-mobile.png`
- `component-style-check.json`: 13/13 passed for cache buster, no layout replacement, activity/session/button/drawer/timeline/filter/task-card replacement, mobile overflow, and mobile tab overlap.

## Residual Risk

- Local server logs still show `better-sqlite3` native module architecture mismatch, so design smoke verification avoided relying on state-write flows.
- The terminal remains the dominant work surface. A deeper command-center product layout would require product-level layout decisions beyond this CSS/component pass.
