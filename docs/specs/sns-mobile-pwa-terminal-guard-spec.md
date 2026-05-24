---
spec_id: SPEC-sns-mobile-pwa-terminal-guard
title: SNS mobile PWA safe back and terminal guard Specification
status: proposed
date: 2026-05-24
story_id: str.brainbase.sns-mobile-pwa-terminal-guard
implementation_files:
  - public/style.css
  - public/modules/app/terminal-input-ux-mixin.js
test_files:
  - tests/e2e/sns-growth-cockpit.spec.js
  - tests/e2e/str-brainbase-sns-mobile-pwa-terminal-guard.spec.ts
  - tests/ui/panel-layout-manager.test.js
  - tests/unit/terminal-display-mixin.test.js
---

# SPEC: SNSモバイルPWAの戻る導線とターミナル誤表示を防ぐ

## Invariants

- INV-1: mobile SNS modeでは`#sns-growth-overlay`が前面の作業面であり、`#terminal-stage`は非表示である。
- INV-2: terminal reveal用のclick/touch handlerは、`_isConsoleVisible()`がfalseならlive terminalを開かない。
- INV-3: `_isConsoleVisible()`は`console-area`だけでなく`#terminal-stage`の表示状態を見る。
- INV-4: SNS overlay headerはmobile/PWAで`safe-area-inset-top`を含む高さを持ち、戻るボタンをステータスバー領域に重ねない。
- INV-5: SNS overlayの戻るボタンは44px以上のタップ領域を持つ。
- INV-6: `state.currentSessionId`に基づくsession UI state更新・summary refresh・session switch guardは、SNS overlayの可視判定変更で変えない。

## Scenarios

### S-1: PWAでSNSから戻る

- given: mobile/PWA viewportでSNS overlayが開いている。
- when: ユーザーが戻るボタンを押す。
- then: ボタンはステータスバーと重ならず、Brainbase terminal modeへ戻る。

### S-2: SNS投稿を確認する

- given: mobile SNS overlayが開いている。
- when: ユーザーが投稿カードをtapする。
- then: SNS詳細が表示され、mobile live terminal modalは開かない。

### S-3: Terminal面を直接tapする

- given: SNS overlayが閉じており、terminal snapshot surfaceが表示されている。
- when: ユーザーがterminal surfaceをtapする。
- then: 既存通りmobile live terminalを開ける。

### S-4: Current sessionのUI state更新は維持する

- given: current sessionが選択されたBrainbase sessionでSNS overlayを開閉する。
- when: terminal reveal touch guardが`#terminal-stage`非表示により抑止される。
- then: `state.currentSessionId`を使うsession UI summary refreshとsession switch後のdeferred workは既存通り動く。

## Verification

- E2E: mobile viewportでSNSを開き、投稿カードtap後にSNS詳細が残り、terminal modalが開かない。
- E2E: SNS overlay中にsnapshot reveal pathを直接発火しても`openMobileLiveTerminal`を呼ばない。
- E2E/CSS: mobile SNS headerのback buttonがsafe-area込みで44px以上のタップ領域を持つ。
- Unit: 既存のpanel layout/session UI state関連テストでcurrent session更新経路の回帰がないことを確認する。
