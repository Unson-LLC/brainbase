---
story_id: judgment-reference-details
title: Brainbase判断・参照除外理由を監査表示する
source_requirement:
  source: Codex conversation 2026-08-12
  approved_at: 2026-08-12
spec_docs:
  - .vibepro/spec/judgment-reference-details/spec.json
architecture_docs:
  - docs/architecture/judgment-reference-details.md
task_docs:
  - docs/management/tasks/TASK-judgment-reference-details.md
pr_scope_strategy: atomic_single_pr
pr_scope_reason: "Judgment receiptとKnowledge Resolver receiptの監査表示欠落を、同じowner向け表示契約として修正するため。"
status: active
created_at: 2026-08-12
updated_at: 2026-08-12
---

# Brainbase判断・参照除外理由を監査表示する

## Story

Brainbaseの判断と参照先選定を監査するownerとして、最終回答の先頭だけを見て、どのprojectを判断対象にし、どの参照先を採用・除外したか、その理由まで確認したい。

## 背景

現行表示は、Judgment Resolverが`needs_classification`を返した場合に「対象を特定できず」とだけ表示し、receiptに保存された`project_code`と`reconciliation_reasons`を落としている。

また、Knowledge Resolverは採用した`source_class`と`canonical_location`のみを表示し、receiptに含まれる`excluded_sources`と理由を表示しない。このため、BAAOのproject参照先を除外していても、owner向け監査行からはその事実を確認できない。

## 受け入れ基準

- [ ] `needs_classification`の監査行は、`reconciliation_reasons`を日本語の理由として表示し、`project_code`がある場合は同じ行に表示する。
- [ ] `conversation_referent_missing`かつ`project_code=baao-project`のreceiptは、「会話上の継続対象を確認できない」と`project=baao-project`を表示する。
- [ ] 解決済みKnowledge Resolver監査行は、採用した参照先・projectを含む正規位置・選択理由を表示する。
- [ ] Knowledge Resolver receiptの`excluded_sources`は、除外した全参照先と各理由を1つの監査行に表示する。
- [ ] 依頼本文、project、参照先、理由は1行に正規化し、秘密らしい値・制御文字・山括弧をそのまま表示しない。未知の理由は安全に短縮した識別子として表示する。
- [ ] `knowledge.resolve`の達成判定、event順序、Stopのfail-closed契約は変更しない。

## スコープ外

- Judgment ResolverやKnowledge Resolverの分類・参照先選定ロジック自体の変更
- 保存済みepisode eventの遡及更新
- 監査行以外のUI変更や本番デプロイ
