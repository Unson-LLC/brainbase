---
spec_id: ux-20261008-01-evidence
story_id: story-ux-20261008-01-evidence
status: active
---

# UX-20261008-01 証拠参照表示 Spec

## データ契約

`contracts/judgment-value-proof/schema.json` の `outcome.evidence_refs[]` は、`kind`・`ref`・`status` を必須とし、`label` を任意で持つ構造化参照である。`status` は `verified` または `unconfirmed` とする。

## 表示契約

- `label` と `kind`・`ref` があれば、ラベルと識別情報を表示する。
- ラベルがなければ、保存された `kind:ref` を表示する。
- 識別情報を組み立てられない参照は `証拠の識別情報は未確認` と表示する。
- `status === "verified"` だけを `確認済み` とし、それ以外は `未確認` と表示する。
- 保存された値をリンク化せず、出典や確認結果を補わない。

## 対象と回帰条件

対象は `#today` の判断履歴詳細を描画する `ui/judgment-history.js` と、そのUIテスト `tests/ui/judgment-history.test.mjs` に限る。契約どおりの構造化4件が詳細の「実行と結果」に表示され、`[object Object]` が0件であることを確認する。識別情報がない参照は固定の未確認文言になることも確認する。
