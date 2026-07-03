# Flow Design Check

| 項目 | 内容 |
|------|------|
| Run ID | 2026-07-02T150653Z |
| Status | needs_review |
| Profile | generic |
| UI走査ファイル | 150件 |
| Interaction | 0件 |
| Silent noop | 0件 |
| Selection side effect | 0件 |
| Question dead end | 0件 |
| Dead UI state | 0件 |
| Interactive contract | 216件 |
| Value alignment | 0件 |

## Silent noop

- なし

## Selection side effect

- なし

## Question dead end

- なし

## Dead UI state

- なし

## Interactive contract

- public/modules/app/ui-setup-mixin.js:430 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Bellで見る` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/app/ui-setup-mixin.js:431 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `閉じる` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:351 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:356 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:356 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:399 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:399 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:461 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:476 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:493 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:537 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `さらに表示` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:566 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/pages/admin-visualization-page.js:615 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:625 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `編集` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:626 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `削除` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:635 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `クリア` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:662 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `保存` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:663 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `削除` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:843 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `編集` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:844 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `削除` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:854 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `クリア` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:875 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `保存` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:876 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `削除` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1102 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Configure` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1155 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1156 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1157 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1190 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1191 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1192 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1198 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1199 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1200 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1221 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `保存` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1231 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `クリア` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1259 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `保存` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1260 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `削除` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1274 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1275 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1276 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1338 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `編集` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1339 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `削除` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1348 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `クリア` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1372 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `保存` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1373 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `削除` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1434 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `編集` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1435 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `削除` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1474 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `接続を保存` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1475 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `接続テスト` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1476 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `切断` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:1526 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Dry-run` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-core.js:2148 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `保存` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/settings/settings-ui.js:108 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/mobile-tab-controller.js:142 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/mobile-tab-controller.js:145 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/archive-modal.js:129 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/archive-modal.js:145 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/archive-modal.js:148 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/completed-tasks-modal.js:73 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/health-alert-modal.js:50 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/health-alert-modal.js:81 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `閉じる` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/learning-candidate-modal.js:123 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/learning-candidate-modal.js:160 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `閉じる` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/learning-candidate-modal.js:161 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `一括却下` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/learning-candidate-modal.js:162 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `一括反映` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/learning-candidate-modal.js:163 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `差し戻し` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/learning-candidate-modal.js:164 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `期限切れ` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/learning-candidate-modal.js:165 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `却下` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/modals/learning-candidate-modal.js:166 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `反映する` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/file-viewer-view.js:113 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/file-viewer-view.js:116 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/file-viewer-view.js:119 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/file-viewer-view.js:128 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/folder-tree-view.js:347 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/folder-tree-view.js:362 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/inbox-view.js:145 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/inbox-view.js:169 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:124 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `${(projections.map?.summaryPills || []).map((pill) =$ `` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:126 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:144 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:162 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:179 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:196 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:212 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:229 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:233 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:316 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `初期タブ: $` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:330 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:340 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `${buttons.map((button) =$ `` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:342 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:367 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:368 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `上申資料を作成` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:369 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `判断メモを作成` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:370 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `保留` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:386 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/lead-console-view.js:387 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `担当案件で絞る` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/next-tasks-view.js:101 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/next-tasks-view.js:105 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/next-tasks-view.js:108 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/next-tasks-view.js:111 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/nocodb-tasks-view.js:206 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `再試行` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/nocodb-tasks-view.js:263 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `設定を開く` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/nocodb-tasks-view.js:336 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/nocodb-tasks-view.js:339 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/nocodb-tasks-view.js:342 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/nocodb-tasks-view.js:353 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/nocodb-tasks-view.js:357 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/nocodb-tasks-view.js:362 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/nocodb-tasks-view.js:431 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/portal-overlay-view.js:321 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/portal-sections/frame-section.js:7 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Frame未設定` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/portal-sections/frame-section.js:98 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/portal-view.js:52 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:232 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:237 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:238 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Clone:` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:239 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:241 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:242 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Workspace:` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:243 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:245 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:246 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Current:` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:247 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:249 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:250 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Session:` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:251 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:254 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:255 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Memory:` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/session-context-bar-view.js:256 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$ / $` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:609 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:618 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:630 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:636 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:637 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:638 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:657 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:659 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:660 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `今週` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:665 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `カレンダー` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:666 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `リサーチ` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:667 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `レビュー` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:668 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `ラーニング` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:671 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:672 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `すべてのアカウント` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:673 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:674 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:683 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `${SUMMARY_ITEMS.map(item =$ `` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:685 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `article` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:686 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `span` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:713 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `再読み込み` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:796 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:797 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `投稿既定` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:798 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `metrics既定` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:819 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:836 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `今週を見る` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:847 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:900 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:917 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `${post.status === 'posted' ? '` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:918 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `学習準備にする` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:919 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Xで削除済みにする` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:925 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:932 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:933 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `スケジュール` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:934 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `投稿確認` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:935 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Xに投稿` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:936 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `スキップする` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:942 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:943 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `投稿確認` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:944 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Xに投稿` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:945 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `スキップする` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:950 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:951 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `承認する` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:952 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `スケジュール` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:953 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `スキップする` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:961 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `aside` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:963 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `Ledgerに投稿がありません。` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:968 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `aside` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:971 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:973 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:974 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `X` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:977 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `dl` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:978 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:983 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `label` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:987 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `label` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:994 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `label` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1000 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `label` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1006 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `div` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1008 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1009 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1010 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `JST` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1012 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `label` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1041 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `section` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1046 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `最終取得 $` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1048 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `p` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1053 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$ $` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/sns-growth-cockpit-view.js:1093 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/task-view.js:44 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/task-view.js:47 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/task-view.js:61 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/task-view.js:64 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/task-view.js:79 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `完了` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-list-view.js:38 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-list-view.js:62 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `全て` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-list-view.js:63 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `セッション` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-list-view.js:64 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `タスク` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-list-view.js:65 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `手動` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-list-view.js:150 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-list-view.js:172 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-list-view.js:175 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-view.js:179 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/timeline-view.js:442 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/wiki-view.js:193 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/wiki-view.js:197 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/wiki-view.js:205 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/ui/views/wiki-view.js:298 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `button` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。
- public/modules/utils/ansi-to-html.js:336 interactive_element_without_contract severity=High gate_effect=review クリック可能に見える `$` が、onClick/href/submit/disabled/準備中表示などの操作契約を持っていない。

## Value alignment

- なし

## Runtime probe plan

- なし
