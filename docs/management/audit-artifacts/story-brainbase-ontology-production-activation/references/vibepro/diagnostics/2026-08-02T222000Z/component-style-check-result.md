# コンポーネントスタイル診断結果

| 項目 | 内容 |
|------|------|
| Run ID | 2026-08-02T222000Z |
| 走査ファイル | 142件 |
| 検出コンポーネント種別 | badge, button, card, filter, input, list_item, modal, sidebar, tab |
| 旧トークン候補 | 13件 (block: 0件, review: 13件, info: 0件) |
| 操作信頼性候補 | 0件 (block: 0件, review: 0件, info: 0件) |
| design-system marker | 3件 |
| 置換確認可能 | yes |

## コンポーネントInventory

- public/device.html:100 input `.input-group {`
- public/device.html:104 input `.input-group label {`
- public/device.html:112 input `.input-group input {`
- public/device.html:127 input `.input-group input:focus {`
- public/device.html:132 input `.input-group input::placeholder {`
- public/device.html:138 button `.btn {`
- public/device.html:154 button `.btn:hover {`
- public/device.html:160 button `.btn:disabled {`
- public/device.html:168 button `.btn-secondary {`
- public/device.html:175 button `.btn-secondary:hover {`
- public/device.html:197 badge `.status-icon {`
- public/device.html:208 badge `.status-icon.success {`
- public/device.html:213 badge `.status-icon.error {`
- public/device.html:238 input `<!-- Step 1: User Code Input -->`
- public/device.html:239 input `<div class="step active" id="step-input">`
- public/device.html:242 input `<div class="input-group">`
- public/device.html:243 input `<label for="user-code-input">認証コード (XXXX-XXXX)</label>`
- public/device.html:244 input `<input`
- public/device.html:246 input `id="user-code-input"`
- public/device.html:253 button `<button class="btn" id="verify-btn" disabled>次へ</button>`
- public/device.html:265 button `<button class="btn" id="slack-login-btn">Slackでログイン</button>`
- public/device.html:266 button `<button class="btn btn-secondary" id="back-to-input-btn">戻る</button>`
- public/device.html:277 button `<button class="btn" id="approve-btn">許可</button>`
- public/device.html:278 button `<button class="btn btn-secondary" id="deny-btn">拒否</button>`
- public/device.html:283 badge `<div class="status-icon success">✓</div>`
- public/device.html:286 button `<button class="btn" onclick="window.close()">閉じる</button>`
- public/device.html:291 badge `<div class="status-icon error">✕</div>`
- public/device.html:294 button `<button class="btn" onclick="location.reload()">もう一度試す</button>`
- public/modules/app/event-listeners-mixin.js:8 modal `import { showConfirm } from '../confirm-modal.js';`
- public/modules/app/event-listeners-mixin.js:14 list_item `// Bridge: React session-list island delegates row actions here so the`
- public/modules/app/event-listeners-mixin.js:48 modal `// Reuse the existing rename modal via the public RENAME_SESSION event.`
- public/modules/app/event-listeners-mixin.js:96 modal `// Terminal copy modal`
- public/modules/app/event-listeners-mixin.js:97 button `const copyTerminalBtn = document.getElementById('copy-terminal-btn');`
- public/modules/app/event-listeners-mixin.js:98 modal `const copyTerminalModal = document.getElementById('copy-terminal-modal');`
- public/modules/app/event-listeners-mixin.js:100 button `const copyContentBtn = document.getElementById('copy-content-btn');`
- public/modules/app/event-listeners-mixin.js:166 modal `// Close modal buttons`
- public/modules/app/event-listeners-mixin.js:167 button `const closeModalBtns = document.querySelectorAll('.close-modal-btn');`
- public/modules/app/event-listeners-mixin.js:168 button `closeModalBtns.forEach(btn => {`
- public/modules/app/event-listeners-mixin.js:169 button `btn.addEventListener('click', () => {`
- public/modules/app/event-listeners-mixin.js:170 modal `document.querySelectorAll('.modal.active').forEach(modal => {`
- public/modules/app/event-listeners-mixin.js:171 modal `modal.classList.remove('active');`
- public/modules/app/event-listeners-mixin.js:176 modal `// Close modal on background click`
- public/modules/app/event-listeners-mixin.js:177 modal `document.querySelectorAll('.modal').forEach(modal => {`
- public/modules/app/event-listeners-mixin.js:178 modal `modal.addEventListener('click', (e) => {`
- public/modules/app/event-listeners-mixin.js:179 modal `if (e.target === modal) {`
- public/modules/app/event-listeners-mixin.js:180 modal `modal.classList.remove('active');`
- public/modules/app/event-listeners-mixin.js:213 card `const dashboardPanel = document.getElementById('dashboard-panel');`
- public/modules/app/event-listeners-mixin.js:214 card `const fileViewerPanel = document.getElementById('file-viewer-panel');`
- public/modules/app/event-listeners-mixin.js:245 filter `.filter((session) => session.intendedState !== 'archived')`
- public/modules/app/event-listeners-mixin.js:306 filter `].filter(Boolean);`
- public/modules/app/event-listeners-mixin.js:337 badge `console.log('Task status updated to in_progress:', task.id);`
- public/modules/app/event-listeners-mixin.js:340 badge `console.warn('Failed to update task status:', statusError);`
- public/modules/app/event-listeners-mixin.js:354 modal `// Edit task: open task edit modal`
- public/modules/app/event-listeners-mixin.js:376 modal `// Rename session: open rename modal`
- public/modules/app/event-listeners-mixin.js:397 button `// Setup global UI button handlers`
- public/modules/app/mobile-navigation-mixin.js:4 tab `import { setupTaskTabs } from '../ui/task-tabs.js';`
- public/modules/app/mobile-navigation-mixin.js:5 input `import { MobileInputController } from '../ui/mobile-input-controller.js';`
- public/modules/app/mobile-navigation-mixin.js:18 button `const mobileSessionsBtn = document.getElementById('mobile-sessions-btn');`
- public/modules/app/mobile-navigation-mixin.js:19 button `const mobileTasksBtn = document.getElementById('mobile-tasks-btn');`
- public/modules/app/mobile-navigation-mixin.js:20 button `const mobileDashboardBtn = document.getElementById('mobile-dashboard-btn');`
- public/modules/app/mobile-navigation-mixin.js:21 button `const mobileSettingsBtn = document.getElementById('mobile-settings-btn');`
- public/modules/app/mobile-navigation-mixin.js:22 modal `const sessionsSheetOverlay = document.getElementById('sessions-sheet-overlay');`
- public/modules/app/mobile-navigation-mixin.js:23 modal `const tasksSheetOverlay = document.getElementById('tasks-sheet-overlay');`
- public/modules/app/mobile-navigation-mixin.js:24 modal `const sessionsBottomSheet = document.getElementById('sessions-bottom-sheet');`
- public/modules/app/mobile-navigation-mixin.js:25 modal `const tasksBottomSheet = document.getElementById('tasks-bottom-sheet');`
- public/modules/app/mobile-navigation-mixin.js:26 modal `const closeSessionsSheetBtn = document.getElementById('close-sessions-sheet');`
- public/modules/app/mobile-navigation-mixin.js:27 modal `const closeTasksSheetBtn = document.getElementById('close-tasks-sheet');`
- public/modules/app/mobile-navigation-mixin.js:28 button `const mobileAddSessionBtn = document.getElementById('mobile-add-session-btn') || document.getElementById('mobile-new-session-btn');`
- public/modules/app/mobile-navigation-mixin.js:33 modal `// Close Sessions bottom sheet`
- public/modules/app/mobile-navigation-mixin.js:46 modal `// live appStore, so opening the sheet needs no imperative render (Phase K3b`
- public/modules/app/mobile-navigation-mixin.js:50 modal `// Selecting or creating a session should dismiss the sheet. Decoupled from the`
- public/modules/app/mobile-navigation-mixin.js:51 list_item `// row handlers (the island emits SESSION_CHANGED / CREATE_SESSION), and scoped to`
- public/modules/app/mobile-navigation-mixin.js:52 modal `// when the sheet is open so desktop navigation is unaffected.`
- public/modules/app/mobile-navigation-mixin.js:59 modal `// Open Sessions bottom sheet`
- public/modules/app/mobile-navigation-mixin.js:88 tab `const tasksTabContent = document.getElementById('tasks-tab-content');`
- public/modules/app/mobile-navigation-mixin.js:94 tab `const tabButtons = mobileTasksContent.querySelectorAll('.task-tab');`
- public/modules/app/mobile-navigation-mixin.js:95 button `tabButtons.forEach(btn => {`
- public/modules/app/mobile-navigation-mixin.js:96 button `btn.classList.toggle('active', btn.dataset.tab === activeTab);`
- public/modules/app/mobile-navigation-mixin.js:99 tab `const tabContents = mobileTasksContent.querySelectorAll('.task-tab-content');`
- public/modules/app/mobile-navigation-mixin.js:101 card `content.classList.toggle('active', content.id === `${activeTab}-tasks-panel`);`

## 旧トークン候補

- public/device.html:16 tailwind_slate_surface token=#1e293b confidence=medium gate_effect=review `background: linear-gradient(135deg, #0b1120 0%, #1e293b 100%);`
- public/device.html:28 large_rounded_card token=border-radius: 24px confidence=medium gate_effect=review `border-radius: 24px;`
- public/device.html:31 heavy_drop_shadow token=box-shadow: 0 20px confidence=medium gate_effect=review `box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);`
- public/device.html:77 large_rounded_card token=border-radius: 16px confidence=medium gate_effect=review `border-radius: 16px;`
- public/device.html:133 tailwind_slate_muted token=#64748b confidence=medium gate_effect=review `color: #64748b;`
- public/device.html:161 tailwind_slate_border token=#334155 confidence=medium gate_effect=review `background: #334155;`
- public/device.html:162 tailwind_slate_muted token=#64748b confidence=medium gate_effect=review `color: #64748b;`
- public/device.html:214 default_red_accent token=rgba(239, 68, 68 confidence=medium gate_effect=review `background: rgba(239, 68, 68, 0.2);`
- public/device.html:219 default_red_accent token=rgba(239, 68, 68 confidence=medium gate_effect=review `background: rgba(239, 68, 68, 0.1);`
- public/device.html:220 default_red_accent token=rgba(239, 68, 68 confidence=medium gate_effect=review `border: 1px solid rgba(239, 68, 68, 0.3);`
- public/modules/ui/views/portal-sections/story-map-section.js:106 default_red_accent token=#ef4444 confidence=medium gate_effect=review `html += `<div style="margin-bottom:6px"><span style="color:#ef4444;font-weight:600;font-size:10px;text-transform:uppercase">Enemy</span><br>${escapeHtml(s.enemy`
- public/modules/ui/views/portal-sections/story-map-section.js:170 default_red_accent token=#ef4444 confidence=medium gate_effect=review `if (current.blockers) html += `<div style="margin-bottom:4px"><span style="color:#ef4444;font-weight:500">ブロッカー:</span> ${escapeHtml(current.blockers.substring(`
- public/modules/ui/views/portal-sections/value-loop-section.js:95 default_red_accent token=#ef4444 confidence=medium gate_effect=review `['due', isOverdue ? `<span style="color:#ef4444">${dueStr}</span>` : dueStr]`

## 操作信頼性候補

- なし

## design-system marker

- public/modules/core/terminal-transport-client.js:1987 --bb- `this.hostEl.style.setProperty('--bb-terminal-row-height', `${rowHeight}px`);`
- public/modules/ui/views/lead-console-view.js:118 data-component `<div class="lead-console-root" data-component="lead-console">`
- public/modules/ui/views/lead-console-view.js:379 data-component `<article class="lead-actor-card" data-component="lead-actor-card">`
