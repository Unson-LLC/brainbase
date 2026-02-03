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
5. VisualViewport 変化が 0 のときは、Dock の「見えている底」とのギャップをオフセットとして使用する
6. VisualViewport の offsetTop/offsetLeft を `--vv-top` / `--vv-left` に反映し、固定UIが表示領域に追従する
7. Mobile Dock が存在する場合はターミナルスライドを無効化し、二重補正を避ける

## Acceptance Criteria
- iOS Safari (縦, アドレスバー表示) で Dock がキーボード直上に密着する
- Android Chrome でも同様に余白が出ない
- VisualViewport が更新されない端末でも keyboard-open が維持される
- VisualViewport が変化しない端末でも Dock がキーボード直上に密着する
- blur 後は keyboard-open が解除され、下部ナビが復帰する
- キーボード表示中でも Dock/FAB/Debug が画面外へ逃げない（offsetTop 追従）

## Test Plan
- Unit: focus/blur で `inputFocused` が切り替わり、`isInputFocused()` が true を返す
- Unit: `--vv-top` / `--vv-left` が VisualViewport の offset に同期される
- Manual: iPhone Safari/Chrome 縦向きで入力欄をタップし、Dock がキーボード直上に張り付くこと
