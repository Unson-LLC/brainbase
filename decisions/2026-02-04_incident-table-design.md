# Decision Log

- Date: 2026-02-04
- Project: SalesTailor
- Decision Owner: 担当者A
- Decision Type: オペレーション

## 1. Goal
- インシデントを一元管理できるNocoDBテーブルを設計・作成する

## 2. Constraints
- 期日: 2026-02-04
- 工数: 半日以内
- 技術: NocoDBメタAPIで作成、既存テーブルとの整合性
- ビジネス: 重大インシデント時の意思決定と再発防止を迅速化

## 3. Options
- Option A: 既存「バグ」テーブルで運用 / Pros: 追加作業ゼロ / Cons: 影響・対応・再発防止の情報が不足
- Option B: 新規「インシデント」テーブルを追加 / Pros: 専用項目で運用が明確 / Cons: 運用テーブルが増える
- Option C: 「タスク」+「バグ」の連携運用 / Pros: 既存ワークフローに乗せやすい / Cons: インシデント特有の項目が散在

## 4. Evaluation
- A: Impact 2, Effort 1, Time 1
- B: Impact 4, Effort 2, Time 2
- C: Impact 3, Effort 2, Time 2

## 5. Decision
- 採用: B
- 理由（1〜3行）
  - 影響/原因/対応/再発防止を一箇所で管理でき、重大時の判断と振り返りが速くなるため。

## 6. Next 3 Actions
- [ ] Action1: インシデントテーブルの運用開始（担当: 担当者A / 期限: 次回インシデント発生時）
- [ ] Action2: 必要なら関連ビュー/通知の整備（担当: 担当者A / 期限: 2026-02-11）
- [ ] Action3: 初回運用後の項目見直し（担当: 担当者A / 期限: 初回ポストモーテム後）

## 7. Checkpoint
- 初回インシデントのクローズ時に項目/ステータスを再評価
