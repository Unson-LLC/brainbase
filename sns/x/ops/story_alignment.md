# SNS工場化 × ストーリー駆動の対応表

最終更新: 2026-02-12

## 参照正本
- _codex/projects/brainbase/00_story_driven_development.md

## 1. 循環（Decision → Work → Ship → Learn）への対応

| Loop | SNS工場化での対応 | SSOT | 状態可視化 |
| --- | --- | --- | --- |
| Decision | Pillar選定、Batch配分、risk_level判定 | 02_pillars / 06_batches | batch_template | 
| Work | sns-smart生成、QC、レビュー（例外介入） | 05_posts/draft → review + scheduled_posts.yml | qc_checklist / stop_the_line |
| Ship | ready → posted | scheduled_posts.yml（+ 05_posts/scheduledは可読ビュー） | post_template | 
| Learn | 24h/7d計測、勝ち型更新 | 07_metrics / 08_experiments | metricsスナップショット |

## 2. ストーリーゲート（Phase）との整合

| Phase | ストーリーゲート定義 | SNS工場化での実体 |
| --- | --- | --- |
| Phase 2 | 出荷キューが見える | 05_posts の status、review滞留可視化 |
| Phase 3 | 指標回収→学習更新 | 07_metrics / 08_experiments | 
| Phase 4 | 自動循環 | subagentによる生成/QC/出荷 |

※ Phase 2未満で自動化を先行させない

## 3. 導入/販売ストーリー（Step 1-3）への寄与

| Step | 目的 | SNS工場化で提供できる証拠 |
| --- | --- | --- |
| Step 1 | 出荷量KPIの再定義 | published_output_count / sprint の実績 |
| Step 2 | 詰まり診断 | review滞留 / WIP / QC不合格率 |
| Step 3 | 再現性の体験 | draft→review→ready→posted の可視化デモ |

## 4. 運用の禁止事項（ストーリー制約）

- 出荷量が増えない施策は中止
- SSOTが曖昧になる変更はreject
- Phase 2前に自動化を入れない
- review滞留が増えるなら生成を止める

## 5. SNS工場化をストーリーで説明する一文

「生成を増やすのではなく、Decision→Work→Ship→Learnの循環を閉じるためにSNS工場化する」
