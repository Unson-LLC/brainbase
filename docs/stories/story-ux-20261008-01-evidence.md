---
story_id: story-ux-20261008-01-evidence
title: 判断の証拠参照を人が読める形で見返せる
status: active
created_at: 2026-10-08
implementation_started: true
owner_repository: brainbase
depends_on: ["story-personal-value-proof-review-web-v1"]
external_dependencies: []
inspector_finding: UX-20261008-01
---

# 判断の証拠参照を人が読める形で見返せる

## 利用者成果

判断の見返し画面で、実行結果に結び付いた証拠参照を、参照の種類・識別子・ラベルと確認状態から読み取れる。参照が欠けている場合も、欠けたことを未確認として判断できる。

## 受入条件

- [ ] AC-01: 構造化された証拠参照は、記録されたラベル、種類、参照値などの人が読める識別情報を表示する。
- [ ] AC-02: 識別情報が無い、または形式を読めない証拠参照は「証拠の識別情報は未確認」と表示し、`[object Object]`を表示しない。
- [ ] AC-03: `verified`は「確認済み」、それ以外・欠損は「未確認」と表示し、未確認を確認済みに昇格させない。
- [ ] AC-04: 成果物参照も同じ安全な整形を使い、出典リンクや未記録の情報を作らない。
- [ ] AC-05: API、保存形式、Graph、認証、外部送信、既存の履歴入口は変更しない。

## 対象ファイル

- `ui/value-proof-review.js`
- `tests/ui/value-proof-review.test.mjs`
- `docs/stories/story-ux-20261008-01-evidence.md`
- `docs/specs/ux-20261008-01-evidence-spec.md`

## 検証

簡易DOMの判断詳細へ、通常の文字列参照、構造化された識別値、識別情報の無い参照、確認済み／未確認の混在を与える。参照文字列に`[object Object]`が現れず、確認状態とリンク無しを読み戻す。
