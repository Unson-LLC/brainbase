---
story_id: str.brainbase.sns-scheduled-publisher
title: SNS scheduled publisher from Posting Ledger
status: proposed
date: 2026-05-14
reason: "SNS Posting LedgerとSnsLedgerPublishServiceを使う既存アーキテクチャ内のStory登録であり、新しい永続化モデルや外部連携方式を決めないため新規ADRは不要。"
related_specs:
  - SPEC-sns-scheduled-publisher
  - SPEC-sns-posting-engine
---

# Story: SNS予約投稿の実行者

## User Story

brainbaseで日次SNS運用を回すさとけいとして、
承認済みで予約された投稿が、SNS Posting Ledger上の予定時刻に実際に投稿されてほしい。
そうすれば、カレンダーは単なる計画表ではなく、毎回手動で投稿ボタンを押さなくても1日の運用を進められる実行コックピットになる。

## Context

SNS Growth APIでは、投稿のレビュー、承認、予約、dry-run確認ができる。Ledgerには `scheduled_at` と投稿statusが保存されており、`SnsLedgerPublishService` はPostgreSQL claim済みの`publishing` rowだけをXへ投稿できる。公開jobはマルチテナント境界でもあり、review pack取込時に明示されたcanonical tenant／resource bindingを永続化し、投稿前にBrainbase正本へ照合する。

足りていない運用単位は、永続化された予約投稿実行者である。既存M4の `SchedulerService` はin-memoryのテスト/ランタイム補助であり、port 31013で動く現在のSNS Growth Posting Ledgerには接続されていない。そのため、UI上では投稿に時刻を付けられるが、その時刻になったときに実際に投稿するrunnerが存在しない。

## Business Context

目指している運用は「AIがAPIで勝手に投稿する」ことではない。人間がレビューして承認し、自動投稿を明示的に有効化した投稿だけが、予定時刻に実行される状態である。これによりbrainbaseは、投稿案生成だけでなく、日次SNS運用の閉ループへ進める。ただし公開投稿という副作用は、明示的で、観測可能で、X側で可能な範囲だけ取り消せる設計にする。

## Architecture Decision

ADR-unnecessary decision: approved.

このStory登録PRでは新規ADRは不要とする。理由は、SNS Posting Ledger、`SnsLedgerPublishService`、既存の運用ジョブ/launchd境界を使う既存アーキテクチャ内の拡張であり、新しい永続化モデルや外部連携方式を決めるものではないため。

ただし実装PRでは、runnerの責務境界をSpecに従って明示する。特に、Ledgerのdue-post選択、X投稿の実行、二重投稿防止、JST/UTC変換、失敗時のUI表示、公開投稿フラグの責務を混ぜない。

## Implementation Surfaces

このStoryのPRでは、実行コードだけでなく、運用時に同じ契約で判断する面を同一PRに含める。

- Ledger import: review packの `date` / `time` をJST壁時計時刻として `scheduled_at` UTC instantへ変換する。
- Tenant binding import: deployment-localの4つの明示設定からcanonical tenant／resource bindingを生成し、欠落・不正時はLedger API送信前に停止する。
- Scheduled runner: 永続化済み `scheduled_at` と現在時刻の比較だけでdue判定する。
- Tenant authorization: 公開時はtenant runtime／PostgreSQL gatewayを必須にし、Ledger bindingを`background_job`としてclaim／provider呼出し前に認可する。
- Runbook: AC-8の成果物として、既存Ledger行の補正手順、dry-run確認、公開投稿有効化前の判断を明示する。
- Spec: JST/UTC変換、既存mutable rowの再インポート補正、公開済みrow不変を要求契約として固定する。

runbookは別PRに分けない。既存行の `scheduled_at` はデプロイだけでは補正されないため、運用手順が実装と同時に入らないと本番時刻ずれのrelease riskが残る。

## Regression Surfaces

このStoryの回帰確認対象は、SNS Posting Ledgerのimport、PostgreSQL update/claim path、明示test modeだけのJSON repository、scheduled publisher、launchd plist、review-pack import script、SNS APIが読むLedger rowである。`/api/sns-growth`には認証とtenant guardを適用し、対話publish routeはdry-run以外を拒否する。

## Acceptance Criteria

- [ ] AC-1: due-post runnerが、SNS Posting Ledgerから `status=scheduled` かつ `scheduled_at <= now` の投稿を取得できる。
- [ ] AC-2: runnerは、`SNS_AUTO_PUBLISH_ENABLED=true`に加え、tenant runtime、PostgreSQL、canonical tenant／resource bindingが明示され、正本認可に成功した場合だけ投稿する。
- [ ] AC-3: runnerだけがtenant認可、PostgreSQL claim、`SnsLedgerPublishService`の順で実投稿し、`confirm_public_post=true`、account audit、posted URL/status更新を通す。対話APIはdry-run専用とする。
- [ ] AC-4: runnerは冪等である。すでに `scheduled` から移動した投稿は再投稿されず、runnerが同時実行されても同じLedger rowを二重投稿しない。
- [ ] AC-5: 時刻の扱いが明示されている。UI slot、`scheduled_at`、runnerの比較がJST/UTCのどちらで扱われるかを定義し、変換をテストで担保する。
- [ ] AC-6: 投稿に失敗したdue postは、SNS UI上でレビュー/再実行できるだけのerror contextを持って見える。黙って消えたり、無限に再試行し続けたりしない。
- [ ] AC-7: dry-run / staging modeで、X投稿スクリプトを呼ばずにdue-post選択を検証できる。
- [ ] AC-8: 運用デプロイ方法が文書化されている。local commandまたはlaunchd/cron、実行間隔、ログ、公開投稿に必要なtenant runtime／Ledger DB／binding設定が分かり、未設定時はfail closedになる。
- [ ] AC-9: productionでPostgreSQL URLがない場合は503で停止し、JSON Ledgerを作成せずproviderを呼ばない。JSON repositoryは明示test modeだけで利用できる。

## Non-goals

- このStoryでは新しい投稿本文を生成しない。
- 既存のレビュー/承認フローを迂回しない。
- draftを自動承認しない。
- 投稿後のX投稿を自動削除/変更しない。
- SNS Growth UIのカレンダーを置き換えない。

## Open Questions

- runnerはslotぴったりを目指すべきか、1分/5分間隔の遅延許容でよいか。
- 失敗した投稿は新しい `publish_failed` statusへ移すべきか、failure metadata付きで `scheduled` に残すべきか。
- 自動投稿の有効化は、初回リリースではaccount単位、post単位、global設定のどれにするか。
