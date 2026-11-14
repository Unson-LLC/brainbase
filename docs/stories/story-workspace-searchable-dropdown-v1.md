---
story_id: story-workspace-searchable-dropdown-v1
status: active
owner_repository: brainbase
---
# どの画面でも同じ、中で検索できるプルダウンを使う

利用者として、プロジェクトや担当者のように候補が多い絞り込みを、一覧をスクロールして探さずに、名前の一部を打って選びたい。画面ごとに違うプルダウンではなく、どの画面でも同じ操作で選びたい。

## Controller

ADDITION。OSSの共通UI `ui/workspace-kit.js` に検索付きプルダウン `workspaceCombobox` を足す。既存の部品・API・データ契約は変えない。組織版はこの部品を取り込み、作り直さない（台帳 P16・D8）。

## 受入条件

- AC-01: ボタンを押すと候補の一覧が開き、検索欄にフォーカスが移る。打った語で候補の名前と補足を絞り込む（全角・半角、大文字・小文字を区別しない）。
- AC-02: 上下の矢印で候補を移り、Enterで選び、Escで閉じてボタンへフォーカスを戻す。Tab・外側の押下では選ばずに閉じる。ボタン上で文字を打つと、その文字で検索を始める。
- AC-03: 読み上げのため、ボタンは `aria-haspopup=listbox` と開閉状態を持ち、検索欄は `role=combobox` で一覧（`role=listbox`）と今の候補（`aria-activedescendant`）を指す。選んだ候補は `aria-selected` で伝わり、件数は `role=status` で伝わる。
- AC-04: 候補が多いときは先頭の一定数だけを描き、「ほか何件は絞り込むと出ます」と伝える。一致が無いときは「一致する候補はありません」と出す。
- AC-05: 候補が8件以下なら検索欄を出さず、一覧の上でHome・Endも使える。
- AC-06: 候補に無い値が選ばれているときは、その値をそのまま出し、未選択に見せない（P9）。

## 実装境界

- `ui/workspace-kit.js` と `ui/workspace-kit.css` だけに足す。選んだ値は呼び出し側が持ち、`onChange` で受け取る。
- 組織版のタスク画面への組み込みは brainbase-organization 側で行う。

## 検証

- `tests/ui/workspace-combobox.test.mjs` で開閉・絞り込み・キーボード・読み上げ属性・多数の候補・候補外の値を確かめる。
- 組織版のタスク画面に組み込み、実ブラウザで検索・選択を確かめる。
