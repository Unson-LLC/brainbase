---
story_id: story-oss-release-notes-web-v1
title: OSS の既存バージョン履歴を正にリリースノート作成を半自動化する
status: draft
phase: spec
contract_type: feature
owner_repository: brainbase
created_at: 2026-10-28
intent_at: 2026-10-28T09:37:00+09:00
requirement_ledger: RQ-139
depends_on: []
---

# OSS の既存バージョン履歴を正にリリースノート作成を半自動化する

## 決定済みと範囲

既存 https://brainbase.pages.dev/reference/version-history と docs/manual/reference/version-history.md を正にする。PR テンプレ、抽出下書きスクリプト、docs:check を整備する。本計画では docs/manual を変更せず、最終文は人が確定する。

要件台帳: RQ-139「[要件] リリースノートの Web 表示」。調査の正は `/workspace/logs/release-notes-web/REPORT.md`、補助は `/workspace/logs/release-notes-web/DIRECTOR-SUMMARY.md`。

承認: 佐藤さん 2026-10-28 09:37 JST「リリースノートは登録して実装まで進めていい（本番配備と外への公開は別に聞いて）」／Director Reason `01M5ZZ1J2537G5W6536SWF89TT`（入力提示の承認）。調査資料の「Spec 承認待ち」はこの後続承認で A〜C の登録・実装まで進められる範囲で更新する。D の公開範囲・フィルタ方針の決定、本番・公開の実行は承認に含めない。今回実施するのは文書の新規作成のみである。

## 受入条件

- AC-1: PR テンプレに「## リリースノート」と変更概要・互換性・利用者操作の欄を設ける。

- AC-2: PR 本文から追記下書きを生成し、人が確定できる。

- AC-3: docs:check が候補版・公開版・status の既存整合を維持し欠落を検知する。

- AC-4: 公開・配備につながるマージ前に別承認で止める。

## 対象外

- VibePro 全移植・post-merge 自動公開
- docs/manual の直接更新・新規公開ページ・配備トリガー変更
- npm リリース処理・版上げ
- brainbase-unson の変更
- 本番配備・Pages 公開・npm 公開・外への公開（別承認）
- 鍵・資格情報の取得、付与、変更、使用（必要なら別承認）
- 削除（別承認）
- 今回の git push・PR・マージ・デプロイ・外部送信・実装コード作成

## task-plan: 順番・依存・衝突

依存: なし（A と B は独立）。

- template: PR テンプレを整備する（pending、依存: なし）。
- draft: 見出し抽出と追記下書きを実装する（pending、依存: template）。
- check: docs:check と公開ゲートを検証する（pending、依存: draft）。

実装 PR は develop 向け、または docs/manual を触らず scripts/テンプレ/check のみ。main へのマージで docs/manual が変わると Pages が自動配備される。いずれの構成でもマージ前に配備・公開トリガーを読み、Pages・npm 公開につながるマージは別承認まで停止する。配備 workflow を変更しない。

タスクは将来の計画であり実施済みではない。allowed_paths は owner_repository からの相対パスで、新設候補を含む。候補パスの現状は未確認。パス外の変更が必要なら計画を先に改訂する。今回そこには書き込まない。

## 佐藤さんへの問い

- Q-1: develop 候補版を将来どこまで公開するか。公開時期と Pages 配備は別承認で決めるか。
- Q-2: 下書き確定・既存ページへの反映・公開前レビューの担当を誰にするか。

## 未確認と出典の食い違い

REPORT §2-2 の調査事実: VitePress の公開対象は docs/manual/**、main push で Pages が自動配備される。既存 docs:check は候補版等の見出しを検査する。調査時点の develop は 0.47.2 candidate、公開は 0.45.0 candidate。現在値は未確認。

具体的な入出力・候補パス・試験・月次境界等は Spec の設計案で、既存実装の事実や追加承認ではない。URL・GitHub・本番は再照会していない。未確認をゼロ・成功・承認済みに置き換えない。

## 関連文書と作成の記録

[Spec](story-oss-release-notes-web-v1-spec.md) ／ [task-plan](story-oss-release-notes-web-v1.task-plan.json)。2026-10-28 新規作成。RQ-138 は形式参照のみで本文は転用していない。
