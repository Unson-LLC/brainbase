---
story_id: story-company-os-reservation-corrupt-ledger-diagnostics-v1
title: 深いcorrupt ledgerを診断可能な形で拒否する
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-reservations-v1"]
external_dependencies: []
---

# 深いcorrupt ledgerを診断可能な形で拒否する

## 利用者成果

壊れた資源確約履歴を正常と誤認せず、どの深い項目が壊れているかを修復担当が判断できる。

## 対象

- ledgerのネストしたreservation、owner、capacity、revision、status等を深く検証する。
- 最初のエラーだけに潰さず、安定したcodeと安全な診断位置を返す。ただし秘密値や全payloadを無制限に露出しない。
- 壊れたledgerを自動修復・上書き・再確約せず、既存bytesを保持する。

## 受入条件

- [ ] 深い型不一致、欠落、矛盾、改変を検知し、浅いtop-level検証を通過して確約へ進まない。
- [ ] 診断結果は再現可能なcode／path／revision contextを持ち、同じcorrupt ledgerで同じ結果になる。
- [ ] failure時にledger・reservation・外部作用が不変であることをfocused testで確認する。

## 検証と完了

レビュー追補の登録のみ。新Spec、実装、テスト、review、PR、CI、mergeは未着手である。
