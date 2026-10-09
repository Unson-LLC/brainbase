---
spec_id: story-judgment-history-reload-button-layout
story_id: story-judgment-history-reload-button-layout
status: active
---

# 判断履歴の通知と詳細フォールバック 最小Spec

## 通知の表示契約

`workspaceNotice` はラベル、本文、取得元の説明、操作ボタンを通知の直接の子として出力する。共通通知は2列のGridで、直接の子は既定の伸長により列幅いっぱいになるため、判断履歴画面だけ次の宣言で再読み込み操作を左寄せする。

```css
.bb-jh .bb-ws-notice > .bb-ws-button {
  justify-self: start;
}
```

セレクタは `bb-jh` と通知の直接の子に限定し、共通の `bb-ws-notice`、共通ボタン、別画面の操作には影響させない。通知の列、余白、本文、取得元の表示は変えない。

## 通常判断詳細の読み取り契約

- 一覧の通常判断行は、canonical home recordを`row.record`として保持する。
- 詳細読取が成功したときは、既存の`normalizeNormalRecord`で正規化した詳細を表示する。
- 詳細読取が未完了または失敗のときは、同じ`row.record`を既存の`normalizeNormalRecord`へ通し、`selectedReferences`を含む読み取り可能な一覧値を表示する。
- 詳細応答の存在しないフィールドを一覧の値で補完しない。正規化で未記録になった値は未記録として表示する。
- フィードバック入力は詳細読取成功時だけ有効なままとし、フォールバック表示を保存済み詳細の証明にしない。

## 回帰条件

- 取得元の説明を含む部分通知で、再読み込みボタンが通知の直接の子として存在する。
- `judgment-history.css`に画面スコープの`justify-self: start`がある。
- 詳細の遅延中・失敗後も、home recordの当時の参照と詳細未接続の案内が表示される。
- 成功した詳細応答がhomeと異なる参照を持つ場合、詳細の参照だけが表示される。

## 配布根拠

現行配布系ブランチは`origin/develop`。consumerが利用する`@unson/brainbase-mcp@0.23.5`のnpm `gitHead`および`v0.23.5`タグは`98835ea4b24370a96ea81e80716653b416bcd7c3`である。今回の修正は同じ共有UI資材を現行ブランチへ適用する。

