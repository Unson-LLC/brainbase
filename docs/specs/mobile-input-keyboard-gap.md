# Mobile Input Dock: Keyboard Gap Fix

Story: C1-007 (モバイル入力UI)

## Goal
iOS/Android の Safari/Chrome でキーボード表示時に Dock がキーボード直上へ密着し、無駄な余白が出ない。

## Scope
- `public/modules/ui/mobile-input-controller.js`
- UI state (keyboard-open) と Dock 位置制御のみ

## Non-Goals
- オフライン対応
- クリップ/スニペット機能の変更

## Behavior
1. Dock/Composer 入力が focus したら `inputFocused = true` にする
2. `syncKeyboardState()` を即時呼び出し、`body.keyboard-open` を付与
3. フォーカス直後の遅延リサイズ対策として 280ms 後に再同期
4. blur で `inputFocused = false` に戻し、タイマーをクリア

## Acceptance Criteria
- iOS Safari (縦, アドレスバー表示) で Dock がキーボード直上に密着する
- Android Chrome でも同様に余白が出ない
- VisualViewport が更新されない端末でも keyboard-open が維持される
- blur 後は keyboard-open が解除され、下部ナビが復帰する

## Test Plan
- Unit: focus/blur で `inputFocused` が切り替わり、`isInputFocused()` が true を返す
- Manual: iPhone Safari/Chrome 縦向きで入力欄をタップし、Dock がキーボード直上に張り付くこと
