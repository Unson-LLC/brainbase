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

SNS Growth UIでは、投稿のレビュー、承認、予約、手動投稿ができる。Ledgerには `scheduled_at` と投稿statusが保存されており、`SnsLedgerPublishService` は明示的に呼ばれればLedger投稿をXへ投稿できる。

足りていない運用単位は、永続化された予約投稿実行者である。既存M4の `SchedulerService` はin-memoryのテスト/ランタイム補助であり、port 31013で動く現在のSNS Growth Posting Ledgerには接続されていない。そのため、UI上では投稿に時刻を付けられるが、その時刻になったときに実際に投稿するrunnerが存在しない。

## Business Context

目指している運用は「AIがAPIで勝手に投稿する」ことではない。人間がレビューして承認し、自動投稿を明示的に有効化した投稿だけが、予定時刻に実行される状態である。これによりbrainbaseは、投稿案生成だけでなく、日次SNS運用の閉ループへ進める。ただし公開投稿という副作用は、明示的で、観測可能で、X側で可能な範囲だけ取り消せる設計にする。

## Architecture Decision

ADR-unnecessary decision: approved.

このStory登録PRでは新規ADRは不要とする。理由は、SNS Posting Ledger、`SnsLedgerPublishService`、既存の運用ジョブ/launchd境界を使う既存アーキテクチャ内の拡張であり、新しい永続化モデルや外部連携方式を決めるものではないため。

ただし実装PRでは、runnerの責務境界をSpecに従って明示する。特に、Ledgerのdue-post選択、X投稿の実行、二重投稿防止、JST/UTC変換、失敗時のUI表示、公開投稿フラグの責務を混ぜない。

## Acceptance Criteria

- [ ] AC-1: due-post runnerが、SNS Posting Ledgerから `status=scheduled` かつ `scheduled_at <= now` の投稿を取得できる。
- [ ] AC-2: runnerは、たとえば `SNS_AUTO_PUBLISH_ENABLED=true` のような設定で公開投稿が明示的に有効化されている場合だけ投稿する。
- [ ] AC-3: runnerは手動投稿と同じ `SnsLedgerPublishService` 経路を使い、`confirm_public_post=true`、account audit、posted URL/status更新を通す。
- [ ] AC-4: runnerは冪等である。すでに `scheduled` から移動した投稿は再投稿されず、runnerが同時実行されても同じLedger rowを二重投稿しない。
- [ ] AC-5: 時刻の扱いが明示されている。UI slot、`scheduled_at`、runnerの比較がJST/UTCのどちらで扱われるかを定義し、変換をテストで担保する。
- [ ] AC-6: 投稿に失敗したdue postは、SNS UI上でレビュー/再実行できるだけのerror contextを持って見える。黙って消えたり、無限に再試行し続けたりしない。
- [ ] AC-7: dry-run / staging modeで、X投稿スクリプトを呼ばずにdue-post選択を検証できる。
- [ ] AC-8: 運用デプロイ方法が文書化されている。local commandまたはlaunchd/cron、実行間隔、ログ、公開投稿に必要な設定が分かる。

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
