# UNS-447 / UR-008

Use the current shared-header specification (20px/28px, weight 600) and its existing tokens. The earlier issue inventory's 32–44px proposal predates this contract. No token values, colors or font families change. Keep the existing component system; avoid new themes, duplicate tokens and per-screen title sizes.

Workspace titles, legacy page headings, knowledge (overview and project), minutes storage and lineage reference the same title tokens. Page headings use H1 and the shared page-head class; hosts already using the shared topbar suppress duplicate visible titles. Embedded section headings are excluded.

`workspacePageHeader` accepts help, shows at most one short lead sentence (60 characters), and preserves longer explanations in existing keyboard/touch-capable question help. Page help opens downward so the sticky title bar does not cover it. The knowledge overview retains its project-selection explanation in help; historical judgment state and storage/source/error information remain visible.

All 51 UI test files pass (920 tests). Companion organization preview evidence covers desktop/mobile, reduced motion, no horizontal overflow or page errors, and confirms one visible 20px/600 title on 11 accessible routes. The health route falls back under preview permissions and is covered separately by its unit tests. Local source-backed integration is not published npm evidence. Organization must consume an approved published exact pin later; no publication, merge or deployment is part of this change.

help-report.json and help-*.png verify click to open, Escape to close, and viewport containment at 390px and 1440px. Before/after screen captures and the per-route report are in the companion organization PR's docs/design/uns447-validation directory. Existing ink/canvas colors remain unchanged (approximately 11.9:1 contrast). No database integration suite was run for this presentation change.
