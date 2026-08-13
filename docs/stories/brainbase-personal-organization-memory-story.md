---
story_id: story-brainbase-personal-organization-memory
title: 個人記憶と組織記憶をサーバ上で安全に循環させる
status: active
created_at: 2026-08-14
updated_at: 2026-08-14
architecture_docs:
  - docs/architecture/adr-personal-organization-memory-boundary.md
spec_docs:
  - docs/specs/brainbase-personal-organization-memory-spec.md
---

# 個人記憶と組織記憶をサーバ上で安全に循環させる

## 背景

個人の会話、下書き、DMと、会議、公開チャンネル、組織自動化の出来事は、同じ記憶循環へ入っても閲覧範囲が異なる。既存のPersonal KG候補だけでは個人記憶の不変な正本と本人境界がなく、組織イベントにも組織、機密区分、最低役割の強制が不足していた。

## User Story

Brainbase利用者として、自分の記憶は他メンバーから隔離したままサーバ上で検索・整理し、共有したい内容だけを洗浄済みの新しい組織イベントとして承認発行したい。なぜなら、原文を共有領域へ漏らさず、個人と組織の脳を同じ運用基盤で育てたいから。

## 受け入れ基準

- [x] 個人記憶APIは認証済み本人または監査付き代理アクセスだけを受理する。
- [x] `personal_knowledge_events`をowner-scopedな不変イベント正本にする。
- [x] `knowledge_events`を組織イベント正本とし、組織、project、役割、機密区分をDBで強制する。
- [x] 処理段階、意味状態、訂正はイベント包絡の更新ではなくtransitionへ追記する。
- [x] 個人から組織へは、洗浄プレビューと本人承認後に別IDの組織イベントを冪等発行する。
- [x] `memory_candidates`は候補キュー／検索投影に限定する。
- [x] `/ohayo`、`/oyasumi`、`/retro`は本人のPersonal Vaultと許可された組織状態を混ぜずに扱う。
- [x] Runtime Git SHA不一致を朝の最上位異常として扱える。
- [ ] 実PostgreSQLでメンバー2人相当の相互隔離を確認する。
- [ ] 新経路を2週間かつ3ルーティン7回連続で観測する。

## 非目標

- 個人原文を組織イベント、Graph、Receiptへ複製すること
- DBクラスタや暗号鍵の物理分離
- Slack、メール、外部タスク管理への自動送信
- 旧データや互換読取りの即時削除
