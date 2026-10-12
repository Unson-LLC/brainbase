---
story_id: story-meeting-minutes-withdraw-v1
title: 公開した議事録を取り下げる
status: in_progress
created_at: 2026-10-12
implementation_started: true
owner_repository: brainbase
---

# 公開した議事録を取り下げる

## 利用者成果

自分の会議の議事録をプロジェクトに公開した本人として、誤って公開した議事録を取り下げ、関係者の議事録の一覧から外したい。取り下げたことと、誰がいつ取り下げたかは記録に残したい。

## 背景

- 組織版の会議の振り分け（前提台帳D9）は、一括の公開を認める理由に「確定前の件数確認」と「取り下げ」を挙げた。共通コアの議事録の文書には取り下げの操作が無かった。
- 取り下げは消すことではない。議事録と版は残し、取り下げた記録を足す（WM-105：不可逆に近い操作は避ける）。

## 受入条件

- [ ] AC-01: `withdraw_minutes({ minutes_id, expected_revision, idempotency_key?, idempotency_fingerprint? }, context)` は、会議と議事録の両方に書き込める人だけが実行でき、議事録の文書に `withdrawal: { actor_id, withdrawn_at }` を記録する。版と本文は消さない。
- [ ] AC-02: `list_meetings` の要約は取り下げた議事録の文書を含めない。`get_meeting` の詳細は取り下げた文書も `withdrawal` 付きで返す（履歴を読める）。
- [ ] AC-03: 取り下げた議事録の文書には、新しい版の保存と確定を断る（`invalid_input`）。
- [ ] AC-04: すでに取り下げた文書を取り下げても、記録を変えずに同じ結果を返す。同じ冪等キーの再送は同じ結果を返し、別の要求に使い回すと `idempotency_conflict`。
- [ ] AC-05: 保存済みの記録の検査は `withdrawal` の形を確かめ、壊れていれば `corrupt_record` にする。取り下げの冪等の記録は `withdraw_minutes` として受け付ける。

## 範囲外

- 取り下げを戻す操作（再公開は、組織版の公開の流れで新しく行う）。
- ローカルのWebの画面とHTTPの経路（組織版は部品を直接呼ぶ）。
