---
story_id: story-brainbase-knowledge-event-cycle
title: Brainbase知識イベントの自動登録と訂正
status: implemented
created_at: 2026-08-13
updated_at: 2026-08-13
architecture_docs:
  - docs/architecture/adr-knowledge-event-cycle.md
spec_docs:
  - docs/specs/brainbase-knowledge-event-cycle-spec.md
---

# Brainbase知識イベントの自動登録と訂正

## 背景

議事録や外部ランナーの結果からDecision候補を作れても、出典、決定権者、適用範囲を満たした判断がGraphで検索可能になるまでの閉ループがない。登録失敗、根拠不足、既存Graphとの競合も成功と区別できない。

## User Story

Brainbase利用者として、議事録、判断、実行結果を自動登録し、根拠のある組織判断だけをGraphへ反映したい。なぜなら、人間の事前承認を毎回待たず、登録後の通知と訂正で会社の現在を保ちたいから。

## Acceptance Criteria

- [x] `knowledge_event.v1`の必須項目を検証し、同一イベントの再送を冪等に扱う。
- [x] すべての入力に不変イベント包絡、候補、処理段階履歴を残す。
- [x] 明示的なDecision、決定権、適用範囲、出典が揃った場合だけGraphへ自動反映する。
- [x] 権限不明、競合、個人情報、適用範囲不明は隔離し、Graph検索へ出さない。
- [x] 処理状況APIは段階履歴から読取モデルを生成し、第二のReceipt正本を作らない。
- [x] 訂正と却下は新イベントとして残し、旧状態を`superseded`または`retracted`へ移す。
- [x] タスク候補を外部実行しない。
- [x] Meeting Review Packageを親Episodeへ結び、必須結果欠落を成功扱いにしない。

## 非目標

- Slack、メール、外部タスク管理への送信
- Resolver receiptを行動許可として扱うこと
- 生の議事録本文をGraphへ保存すること

## 導入時の確認事項

- 正式マイグレーションを実環境へ適用する。
- 実環境でMeeting候補取り込みからEvent、Candidate、Graph検索、訂正後の検索除外までを確認する。
