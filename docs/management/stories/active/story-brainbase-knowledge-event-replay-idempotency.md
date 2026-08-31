---
story_id: story-brainbase-knowledge-event-replay-idempotency
title: Brainbase Knowledge Event 再送の冪等性
status: active
reason: "永続化時の検索・権限用既定値を維持しつつ、再送identityは保存済みの受信イベント原形と比較して、同一イベントのfalse conflictだけを解消する局所修正。"
spec_docs:
  - docs/specs/story-brainbase-knowledge-event-replay-idempotency-spec.md
created_at: 2026-08-31
updated_at: 2026-08-31
---

# Brainbase Knowledge Event 再送の冪等性

## User Story

VibeProのMCPクライアントとして、同じ`knowledge_event.v1`を安全に再送したい。そうすれば、通信結果が不明な場合にも候補を重複生成せず、既存の記録receiptを受け取れる。

## 背景

PostgreSQL永続化後のイベントには、検索・権限用の`organization_id`、`sensitivity`、`role_min`、`venue`が補完される。再送時にこの正規化済み行と元イベントを比較すると、元イベントで未指定の項目が差分となり、同一内容でも409 conflictになっていた。

## Delivery Boundary

永続化済み行に保持された受信時の`knowledge_event.v1` payloadを、再送identityの比較元として使う。正規化済み列、認証・organization・project境界、候補生成、Graph昇格条件は変更しない。

## 受け入れ基準

- [ ] AC-001: 保存時に既定列が補完されても、同一イベントの再送はidempotent成功する。
- [ ] AC-002: 保存済みの受信イベントと`body_hash`または他のidentity項目が異なる再送はconflictになる。
- [ ] AC-003: 再送では新しいcandidateやGraph entityを生成しない。
- [ ] AC-004: Knowledge Event service、PostgreSQL repository、route、MCP契約テストと型検査・Lintが通る。

## 非目標

イベントschema、永続化列、アクセス制御、候補の採用、Graphへの自動昇格、外部実行権限、VibePro側のevent生成契約は変更しない。
