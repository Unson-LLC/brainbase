---
spec_for: story-oss-release-notes-web-v1
title: OSS の既存バージョン履歴を正にリリースノート作成を半自動化する
status: draft
phase: spec
owner_repository: brainbase
created_at: 2026-10-28
requirement_ledger: RQ-139
---

# OSS の既存バージョン履歴を正にリリースノート作成を半自動化する — Spec

[Story](story-oss-release-notes-web-v1.md) ／ [task-plan](story-oss-release-notes-web-v1.task-plan.json)

## 根拠と承認

要件台帳: RQ-139「[要件] リリースノートの Web 表示」。調査の正は `/workspace/logs/release-notes-web/REPORT.md`、補助は `/workspace/logs/release-notes-web/DIRECTOR-SUMMARY.md`。

承認: 佐藤さん 2026-10-28 09:37 JST「リリースノートは登録して実装まで進めていい（本番配備と外への公開は別に聞いて）」／Director Reason `01M5ZZ1J2537G5W6536SWF89TT`（入力提示の承認）。調査資料の「Spec 承認待ち」はこの後続承認で A〜C の登録・実装まで進められる範囲で更新する。D の公開範囲・フィルタ方針の決定、本番・公開の実行は承認に含めない。今回実施するのは文書の新規作成のみである。

本番配備・Pages 公開・npm 公開・外への公開は別承認とする。今回のコード変更・git push・PR・マージ・デプロイ・外部送信は行わない。

## 範囲と境界

既存 https://brainbase.pages.dev/reference/version-history と docs/manual/reference/version-history.md を正にする。PR テンプレ、抽出下書きスクリプト、docs:check を整備する。本計画では docs/manual を変更せず、最終文は人が確定する。

実装 PR は develop 向け、または docs/manual を触らず scripts/テンプレ/check のみ。main へのマージで docs/manual が変わると Pages が自動配備される。いずれの構成でもマージ前に配備・公開トリガーを読み、Pages・npm 公開につながるマージは別承認まで停止する。配備 workflow を変更しない。

依存: なし（A と B は独立）。

## AC の具体化

### AC-1: PR テンプレに「## リリースノート」と変更概要・互換性・利用者操作の欄を設ける。

既存項目を保持する。抽出範囲は当該見出し直下から次の同階層以上の見出しまで。

### AC-2: PR 本文から追記下書きを生成し、人が確定できる。

PR 番号・本文等をローカル入力として受け、標準出力へ下書きを出す。docs/manual を自動更新しない。見出し欠落・空欄は「要確認」とし本文全体へ fallback しない。同じ PR の再実行で同じマーカーを返し、重複を防ぐ。

### AC-3: docs:check が候補版・公開版・status の既存整合を維持し欠落を検知する。

package.json の版に対応する見出しを検査する既存契約を保つ。正常・見出し欠落・版不整合の fixture で終了コードを検証する。実文書を書き換えて検査を通さない。成功を npm 公開済みの根拠にしない。

### AC-4: 公開・配備につながるマージ前に別承認で止める。

実装差分は scripts・テンプレ・check のみとする。docs/manual、配備 workflow、npm release スクリプト、package version は変更しない。develop 宛てでも将来の main 統合前には Pages・npm 公開ゲートを再確認する。

## 検証計画

task-plan の各タスクの acceptance_criteria は該当 AC を具体化した同じ契約とする。実装時には allowed_paths に示した候補試験でローカル fixture・fake を使い、正常・欠落・拒否・再実行など該当 AC を確認する。実 credential・外部 API・本番は使わない。D は文書と blocked 状態の確認のみで、試験コードも作らない。今回実装試験は未実施である。

## やらないこと

- VibePro 全移植・post-merge 自動公開
- docs/manual の直接更新・新規公開ページ・配備トリガー変更
- npm リリース処理・版上げ
- brainbase-unson の変更
- 本番配備・Pages 公開・npm 公開・外への公開（別承認）
- 鍵・資格情報の取得、付与、変更、使用（必要なら別承認）
- 削除（別承認）
- 今回の git push・PR・マージ・デプロイ・外部送信・実装コード作成

## 佐藤さんへの問い

- Q-1: develop 候補版を将来どこまで公開するか。公開時期と Pages 配備は別承認で決めるか。
- Q-2: 下書き確定・既存ページへの反映・公開前レビューの担当を誰にするか。

## 事実・設計案・未確認

REPORT §2-2 の調査事実: VitePress の公開対象は docs/manual/**、main push で Pages が自動配備される。既存 docs:check は候補版等の見出しを検査する。調査時点の develop は 0.47.2 candidate、公開は 0.45.0 candidate。現在値は未確認。

具体的な候補パス・入出力・試験等は本 Spec の設計案であり現行実装の存在を示さない。未確認を空・ゼロ・成功・承認済みに変換しない。
