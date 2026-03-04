# E0-002 自動出荷アーキテクチャ（現状ベース）

最終更新: 2026-02-12
対象ストーリー: `E0-002 SNS発信による営業活用（自動出荷＋例外介入）`

## 1. ストーリー要求（今回）
- 毎日自動で `X / X記事 / note` を生成する
- 生成結果を Slack に自動投稿し、内容と予定時刻を確認できる
- 通常系は自動出荷し、人間介入は例外時のみ
- 例外時の操作は `編集 / 却下 / 投稿時間変更` の3つ
- 介入理由と実行者を Run Ledger に残す

## 2. 現状アーキテクチャ（実装済み）
### 2.1 X短文ライン（自動）
- 生成: `sns/x/ops/scripts/factory_line.py`
- キュー: `sns/scheduled_posts.yml`
- 出荷実行: `common/ops/scripts/scheduled_post_runner.py`
- 出荷計画ミラー: `sns/log/dispatch_plan_YYYY-MM-DD.md`

### 2.2 X記事ライン（実装済み）
- 生成: `sns/x/ops/scripts/x_article_line.py`
- キュー投入: `sns/scheduled_posts.yml`（`type: x_article`）
- 公開: `sns/x/ops/scripts/x_article_web_draft.py`（Web自動操作）
- 日次ワークフロー: `.github/workflows/sns-longform-line.yml`

### 2.3 noteライン（実装済み）
- 生成: `sns/x/ops/scripts/note_line.py`
- キュー投入: `sns/scheduled_posts.yml`（`type: note`）
- 投稿: `common/ops/scripts/note_post.py`（Web自動操作）
- 日次ワークフロー: `.github/workflows/sns-longform-line.yml`

### 2.4 レビュー通知・例外介入（NocoDBはミラー）
- NocoDB同期（ミラー）: `sns/x/ops/scripts/sync_review_queue.py`
- Slackレビュー通知（例外介入の入口）: `sns/x/ops/scripts/slack_review_queue.py`
- Slack介入反映（正本更新）: `sns/x/ops/scripts/apply_slack_review_action.py`
- ワークフロー: `.github/workflows/sns-review-queue.yml` / `.github/workflows/sns-review-action.yml` / `.github/workflows/sns-review-sync.yml`
- 旧方式（廃止）: `sns/x/ops/scripts/apply_review_approvals.py`（NocoDBの承認を正本へ反映するゲートは使わない）

## 3. 現状との差分（ストーリー未充足）
1. `X記事 / note` の品質レビュー粒度（自動QC）が `x_post` より薄い  
2. 生成失敗時の自動リトライと失敗通知（Slack）を長文ラインで強化余地あり  

### 3.1 Slackレビュー実行トリガ（実装済み）
- 受信リレー: `tools/sns-review-relay/lambda_function.py`
- デプロイ: `.github/workflows/deploy-sns-review-relay.yml`
- 役割: Slack interactive payload受信 → 署名検証 → `sns-review-action.yml` を `workflow_dispatch`
- `edit`操作: ボタン押下時にモーダルを開き、編集指示テキストを入力して送信（モーダル失敗時は即時フォールバック実行）

## 4. 語彙（ステータス）不整合
現状はステータス語彙が4系統に分かれており、変換ロジックが必要な状態。

### 4.1 Content状態（投稿ファイル）
- 例: `draft / review / ready / posted / skipped / archived`

### 4.2 Queue状態（scheduled_posts.yml）
- 実行対象: `ready / pending`
- 終端: `posted / skipped`

### 4.3 Review状態（NocoDB）
- `pending / approved / published / rejected`

### 4.4 Run Ledger状態
- `queued / running / review / approved / shipped / blocked / failed`

### 4.5 実害
- `scheduled_post_runner.py` に `scheduled -> ready` 正規化を入れ、互換運用に変更済み
- `scheduled_post_runner.py --sync-markdown-only` で `scheduled_posts.yml` を正としてmd同期可能

## 5. 不正語・禁止語で詰まるポイント
`factory_line.py` には投稿本文の語彙ガードがあり、以下で生成が落ちる/再生成される。

### 5.1 禁止語（本文検証）
- `FORBIDDEN_WORDS`: `Next.js, Rails, BigQuery, CRM, SaaS, 受託, コンサル`
- `ABSTRACT_WORDS`: `戦略, 勝率, 本質, 重要, 必要, 最強, 最適解, 教訓, 学び`

### 5.2 ブロック話題（seed段階）
- `BLOCKED_KEYWORDS` はデフォルト空
- `--block-mode` はデフォルト `off`（必要時のみ `keywords/llm/hybrid` を有効化）

### 5.3 影響
- ストーリーが「SNS工場化」中心でもseed自動ブロックしない運用へ変更済み
- 禁止語/抽象語は `--strict-word-guard` 有効時のみ強制ブロック

## 6. このまま進める場合の最小ルール（Architectureガード）
1. ステータス語彙を正規化する（少なくとも変換表を正本化）
2. Slackレビューは「通知」と「承認操作」を分離し、操作は必ず監査ログ化
3. `X / X記事 / note` の3チャネルを同一 `story_id` で追跡する
4. 禁止語ルールは「安全ガード」と「ストーリー語彙」を分離して管理する
5. 例外介入の3操作（編集/却下/時間変更）だけを第一級イベントとして記録する

## 7. 参照実装
- `sns/x/ops/scripts/factory_line.py`
- `common/ops/scripts/scheduled_post_runner.py`
- `sns/x/ops/scripts/sync_review_queue.py`
- `sns/x/ops/scripts/slack_review_queue.py`
- `sns/x/ops/scripts/apply_slack_review_action.py`
- `sns/x/ops/scripts/note_line.py`
- `tools/sns-review-relay/lambda_function.py`
- `.github/workflows/sns-factory-line.yml`
- `.github/workflows/sns-longform-line.yml`
- `.github/workflows/scheduled-sns-post.yml`
- `.github/workflows/sns-review-queue.yml`
- `.github/workflows/sns-review-action.yml`
- `.github/workflows/sns-review-sync.yml`
