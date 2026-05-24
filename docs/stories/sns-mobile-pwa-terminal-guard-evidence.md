# Evidence: SNSモバイルPWAの戻る導線とターミナル誤表示を防ぐ

Story: `str.brainbase.sns-mobile-pwa-terminal-guard`
Head binding: VibePro review request and `.vibepro/pr/str.brainbase.sns-mobile-pwa-terminal-guard/verification-evidence.json` are authoritative for the reviewed head. This file does not hard-code a commit hash because each evidence-map correction changes the commit hash.
Branch: `fix/sns-mobile-pwa-terminal`

## Change Surface

- `public/style.css`
  - mobile SNS modeで`#terminal-stage`、terminal snapshot surfaces、mobile tab/input dockに加えて`#top-banner-stack`を隠す。
  - SNS overlay headerに`safe-area-inset-top`分の上部余白と高さを与える。
  - SNS back buttonを44px以上のtap targetにする。
  - This CSS is Story-required, not a misc follow-up: AC-1 needs safe-area/header/tap-target CSS and AC-2/AC-3 need mobile SNS mode to make terminal surfaces non-interactive while SNS is the active workspace.
- `public/modules/app/terminal-input-ux-mixin.js`
  - mobile terminal reveal touch start/endで`_isConsoleVisible()`がfalseならlive terminalを開かない。
  - direct snapshot click/touch reveal handlerでも`_isConsoleVisible()`がfalseならlive terminalを開かない。
  - session switch、terminal runtime、xterm transport、posting ledgerには触れない。
- `tests/e2e/sns-growth-cockpit.spec.js`
  - 既存SNS mobile E2Eをtap基準に寄せ、back button tap targetとterminal modal非表示を確認する。
- `tests/e2e/str-brainbase-sns-mobile-pwa-terminal-guard.spec.ts`
  - Story専用E2E。SNS詳細tap、terminal抑止、SNS終了後のterminal snapshot reveal維持を同一flowで確認する。
- `docs/stories/sns-mobile-pwa-terminal-guard-story.md`
  - PWA safe-area、SNS overlay tap、terminal surface tap、current session UI state維持を明示する。
- `docs/specs/sns-mobile-pwa-terminal-guard-spec.md`
  - 上記をSpec invariant/scenarioとして固定する。

## Regression Guard

- 既存terminal導線:
  - SNS overlayを閉じた後、`#terminal-snapshot-panel` tapで`openMobileLiveTerminal`が呼ばれることをStory E2Eで確認。
  - touch guardは`#terminal-stage`が非表示の時だけ抑止し、terminal surfaceが表示されている時の導線は維持する。
- 既存session UI state:
  - `state.currentSessionId`を使うsummary refresh/session switch deferred workは変更しない。
  - `npm run test:run -- tests/ui/panel-layout-manager.test.js tests/unit/terminal-display-mixin.test.js`で既存panel/session UI系の回帰を確認。
- API/DB:
  - SNS review-packのseed APIはE2E fixtureとして使うのみ。API contract、DB schema、posting ledger、scheduler、X postingには変更なし。
- Runtime/security:
  - xterm transport、terminal ownership、CSRF、viewerId proxy pathには変更なし。
  - mobile touch handlerの発火条件をDOM可視性で狭めるだけで、新しい権限境界は追加しない。
- Accessibility/mobile usability:
  - back buttonは44px以上のtap targetを持つ。
  - PWA safe-area上にheader paddingを置き、iOS status areaと重ねない。

## Path And Surface Coverage

- Input paths:
  - SNS overlay entry: `#mobile-sns-growth-btn`
  - SNS post review tap: `.sns-mobile-decision-card[data-post-id]`
  - SNS exit: `#sns-growth-back-terminal`
- Existing terminal reveal: `#terminal-snapshot-panel`
  - While SNS overlay is active and `#terminal-stage` is hidden, direct snapshot click is also suppressed.
- Output surfaces:
  - SNS detail pane remains visible after card tap.
  - `#mobile-live-terminal-modal` remains inactive while SNS overlay is open.
  - `#terminal-stage` is hidden during SNS overlay and visible after exit.
  - VibePro PR artifacts (`pr-body.md`, `gate-dag.json`, `review-cockpit.html`) point to current-head verification evidence.
- Fallback/legacy paths:
  - Desktop SNS layout is a non-goal and is not changed by the mobile media query.
  - Existing terminal snapshot reveal remains covered after SNS exit.

## Verification Evidence

- Unit:
  - Command: `npm run test:run -- tests/ui/panel-layout-manager.test.js tests/unit/terminal-display-mixin.test.js`
  - Status: pass
  - Artifact: `.vibepro/verification/2026-05-24T-sns-mobile-pwa-terminal/unit-final5.log`
- Typecheck:
  - Command: `npm run typecheck`
  - Status: pass
  - Artifact: `.vibepro/verification/2026-05-24T-sns-mobile-pwa-terminal/typecheck-final5.log`
- E2E:
  - Command: `npx playwright test tests/e2e/sns-growth-cockpit.spec.js tests/e2e/str-brainbase-sns-mobile-pwa-terminal-guard.spec.ts`
  - Status: pass
  - Artifact: `.vibepro/verification/2026-05-24T-sns-mobile-pwa-terminal/e2e-sns-growth-and-story-final3.log`
  - Coverage: modified legacy SNS Growth Cockpit E2E plus Story AC-1..AC-6 E2E, 8 tests passed.
  - Runtime coverage: Story E2E collects browser console errors, page errors, failed requests, and non-favicon HTTP responses >= 400 during the mobile SNS flow and asserts that none occur.
- Visual/manual:
  - Command: `node var/sns-mobile-visual-check.mjs`
  - Status: pass
  - Artifact: `.vibepro/verification/2026-05-24T-sns-mobile-pwa-terminal/visual-final4.log`
  - Result: back button box `height=44`, `y=3.5`, and `terminalHidden=true` on iPhone 12 Pro viewport.

## Split And Release Risk

- PR size: 6 product/test/story/spec files plus this evidence note; one focused intent.
- Split-plan override: `public/style.css` remains in this PR because the defect is a mobile PWA layout/tap-target defect. Splitting the CSS would leave AC-1, AC-2, and AC-3 unresolved.
- No migration, no env var, no scheduler change, no posting behavior change.
- Rollout risk is limited to mobile SNS overlay CSS and mobile terminal reveal touch guard.
- Main operational risk is a false negative where terminal reveal is suppressed outside SNS. The Story E2E covers the inverse by proving terminal snapshot still opens live terminal after SNS exit.
