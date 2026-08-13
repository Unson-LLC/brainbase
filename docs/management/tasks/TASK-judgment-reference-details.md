---
task_id: TASK-judgment-reference-details
story_id: judgment-reference-details
status: in_progress
priority: high
created_at: 2026-08-12
---

# Brainbase判断・参照除外理由を監査表示へ投影する

## 実装

1. clarification receiptの`reconciliation_reasons`と`project_code`を安全な1行へ投影する。
2. Knowledge Resolver receiptの採用先、正規位置、採用理由、全除外先と理由を同じ監査行へ投影する。
3. 未知理由、改行、秘密らしい値、山括弧、Object継承キーを安全に扱う。
4. `knowledge.resolve`達成判定、event順序、Stopのfail-closed契約を回帰テストで維持する。
5. VibeProのSpec、検証、レビュー、PR証跡をStoryへ束縛する。

## 完了条件

- BAAOの`project:baao/docs/`採用と、wiki・graph・team_drive・personal_kg・workspace_homeの除外理由が監査行へ表示される。
- `conversation_referent_missing`と`project=baao-project`がclarification監査行へ表示される。
- 対象unit/integration、Judgment Resolver回帰スイート、UI/MCP型検査、MCP testが通過する。
- VibePro reviewとPR preparationが完了し、VibePro経由でPRを作成する。

## Graphify impact

pre-architecture Graphifyで、変更境界は`buildOwnerAudit`と`routeDisplayLine`を中心とするreceipt表示投影に限定できることを確認した。Resolverの分類、参照先選定、capability達成判定は変更しない。
