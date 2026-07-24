# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | 判断委任KPIフェーズ1 サーバー側イベント受信・週次集計 |
| Story ID | story-brainbase-decision-events-kpi-v1 |
| Run ID | 2026-07-24T045039Z |
| Gate | needs_review |
| タスク数 | 2 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| VP-TASK-FLOW-006 | VP-FLOW-006 | high | 22件 | manual-review | todo |
| VP-TASK-STATIC-003 | VP-STATIC-003 | high | 39件 | manual-review | todo |

## VP-TASK-FLOW-006: クリック可能に見えるUIに操作契約がない候補がある

- Source: finding / VP-FLOW-006
- Execution: proposal_only / mutates_repository=false
- Target files: public/modules/app/ui-setup-mixin.js, public/modules/pages/admin-visualization-page.js, public/modules/settings/settings-core.js, public/modules/settings/settings-ui.js, public/modules/ui/mobile-tab-controller.js, public/modules/ui/modals/archive-modal.js, public/modules/ui/modals/health-alert-modal.js, public/modules/ui/modals/learning-candidate-modal.js, public/modules/ui/views/file-viewer-view.js, public/modules/ui/views/folder-tree-view.js, public/modules/ui/views/inbox-view.js, public/modules/ui/views/lead-console-view.js, public/modules/ui/views/nocodb-tasks-view.js, public/modules/ui/views/portal-overlay-view.js, public/modules/ui/views/portal-sections/frame-section.js, public/modules/ui/views/portal-view.js, public/modules/ui/views/session-context-bar-view.js, public/modules/ui/views/sns-growth-cockpit-view.js, public/modules/ui/views/timeline-list-view.js, public/modules/ui/views/timeline-view.js, public/modules/ui/views/wiki-view.js, public/modules/utils/ansi-to-html.js
- Target groups: -
- Read first: public/modules/app/ui-setup-mixin.js, public/modules/pages/admin-visualization-page.js, public/modules/settings/settings-core.js, public/modules/settings/settings-ui.js, public/modules/ui/mobile-tab-controller.js, public/modules/ui/modals/archive-modal.js, public/modules/ui/modals/health-alert-modal.js, public/modules/ui/modals/learning-candidate-modal.js, public/modules/ui/views/file-viewer-view.js, public/modules/ui/views/folder-tree-view.js, public/modules/ui/views/inbox-view.js, public/modules/ui/views/lead-console-view.js, public/modules/ui/views/nocodb-tasks-view.js, public/modules/ui/views/portal-overlay-view.js, public/modules/ui/views/portal-sections/frame-section.js, public/modules/ui/views/portal-view.js, public/modules/ui/views/session-context-bar-view.js, public/modules/ui/views/sns-growth-cockpit-view.js, public/modules/ui/views/timeline-list-view.js, public/modules/ui/views/timeline-view.js, public/modules/ui/views/wiki-view.js, public/modules/utils/ansi-to-html.js
- Recommended strategy: manual-review

完了条件:
- クリック可能に見える要素は、保存、表示変化、画面遷移、scroll/focus、disabled、または準備中表示のいずれかに分類できるようにする。画面単位で全クリック可能要素を棚卸しし、Playwrightでは主要導線だけでなく押せそうなUIの反応も確認する。

## VP-TASK-STATIC-003: XSS につながり得る DOM 操作がある

- Source: finding / VP-STATIC-003
- Execution: proposal_only / mutates_repository=false
- Target files: public/dist/session-list-island.js, public/modules/app/mobile-navigation-mixin.js, public/modules/app/session-creation-mixin.js, public/modules/app/terminal-input-ux-mixin.js, public/modules/app/ui-setup-mixin.js, public/modules/components/donut-chart.js, public/modules/components/gauge-chart.js, public/modules/components/line-chart.js, public/modules/components/project-card.js, public/modules/confirm-modal.js, public/modules/device/device-auth-controller.js, public/modules/iframe-contextmenu-handler.js, public/modules/pages/admin-visualization-page.js, public/modules/settings/settings-core.js, public/modules/settings/settings-ui.js, public/modules/setup/setup-controller.js, public/modules/ui/choice-overlay-controller.js, public/modules/ui/mobile-input-sheet-manager.js, public/modules/ui/mobile-tab-controller.js, public/modules/ui/modals/archive-modal.js, public/modules/ui/modals/health-alert-modal.js, public/modules/ui/modals/project-details-modal.js, public/modules/ui/modals/task-add-modal.js, public/modules/ui/views/base-view.js, public/modules/ui/views/commit-tree-view.js, public/modules/ui/views/file-viewer-view.js, public/modules/ui/views/folder-tree-view.js, public/modules/ui/views/inbox-view.js, public/modules/ui/views/lead-console-view.js, public/modules/ui/views/live-feed-view.js, public/modules/ui/views/nocodb-tasks-view.js, public/modules/ui/views/portal-overlay-view.js, public/modules/ui/views/portal-view.js, public/modules/ui/views/sns-growth-cockpit-view.js, public/modules/ui/views/timeline-list-view.js, public/modules/ui/views/timeline-view.js, public/modules/ui/views/wiki-view.js, scripts/vibepro-component-style-check.mjs, ui-islands/session-list/index.jsx
- Target groups: -
- Read first: public/dist/session-list-island.js, public/modules/app/mobile-navigation-mixin.js, public/modules/app/session-creation-mixin.js, public/modules/app/terminal-input-ux-mixin.js, public/modules/app/ui-setup-mixin.js, public/modules/components/donut-chart.js, public/modules/components/gauge-chart.js, public/modules/components/line-chart.js, public/modules/components/project-card.js, public/modules/confirm-modal.js, public/modules/device/device-auth-controller.js, public/modules/iframe-contextmenu-handler.js, public/modules/pages/admin-visualization-page.js, public/modules/settings/settings-core.js, public/modules/settings/settings-ui.js, public/modules/setup/setup-controller.js, public/modules/ui/choice-overlay-controller.js, public/modules/ui/mobile-input-sheet-manager.js, public/modules/ui/mobile-tab-controller.js, public/modules/ui/modals/archive-modal.js, public/modules/ui/modals/health-alert-modal.js, public/modules/ui/modals/project-details-modal.js, public/modules/ui/modals/task-add-modal.js, public/modules/ui/views/base-view.js, public/modules/ui/views/commit-tree-view.js, public/modules/ui/views/file-viewer-view.js, public/modules/ui/views/folder-tree-view.js, public/modules/ui/views/inbox-view.js, public/modules/ui/views/lead-console-view.js, public/modules/ui/views/live-feed-view.js, public/modules/ui/views/nocodb-tasks-view.js, public/modules/ui/views/portal-overlay-view.js, public/modules/ui/views/portal-view.js, public/modules/ui/views/sns-growth-cockpit-view.js, public/modules/ui/views/timeline-list-view.js, public/modules/ui/views/timeline-view.js, public/modules/ui/views/wiki-view.js, scripts/vibepro-component-style-check.mjs, ui-islands/session-list/index.jsx
- Recommended strategy: manual-review

完了条件:
- ユーザー入力をHTMLとして挿入しない。必要な場合はサニタイズし、textContentなど安全な代替を使う。