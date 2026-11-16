---
story_id: story-ux-20261008-01-evidence
title: 判断の履歴で実行結果の証拠参照を読める
status: active
created_at: 2026-10-08
owner_repository: brainbase
inspector_finding: UX-20261008-01
---

# 判断の履歴で実行結果の証拠参照を読める

## 利用者成果

`#today` の「判断の履歴」で記録を開いたとき、実行結果に保存された証拠参照を、人が読める識別情報と確認状態で読み返せる。参照の識別情報が欠けている場合も、未確認であることが分かる。

## 受入条件

- [ ] AC-01: `outcome.evidence_refs[]` の構造化参照は、保存されたラベルまたは種類・参照値を表示する。
- [ ] AC-02: `verified` は「確認済み」、それ以外は「未確認」と表示し、状態を確認済みに昇格させない。
- [ ] AC-03: 識別情報がない参照は「証拠の識別情報は未確認」と表示し、`[object Object]` を表示しない。
- [ ] AC-04: 記録された参照値をリンクへ変換せず、API、保存形式、Graph、認証、外部送信を変更しない。

## 対象

- `ui/judgment-history.js`
- `tests/ui/judgment-history.test.mjs`
- 本Storyと同IDのSpec

## 検証

判断履歴UIの詳細を開くテストに、契約どおりの構造化証拠参照4件を渡す。ラベル付き・ラベルなし、確認済み・未確認の表示と、`[object Object]` がないことを読み戻す。識別情報がない入力は明示的な未確認として表示されることも確認する。
