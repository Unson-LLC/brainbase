---
story_id: story-company-os-reservation-runtime-input-safety-v1
title: null runtime inputを確約前にfail-closedで拒否する
status: planned
created_at: 2026-09-23
implementation_started: false
owner_repository: brainbase
depends_on: ["story-company-os-reservations-v1"]
external_dependencies: []
---

# null runtime inputを確約前にfail-closedで拒否する

## 利用者成果

実行入力が欠落したまま資源を予約したり、曖昧な入力で判断を進めたりしない。

## 対象

- `null`、`undefined`、必要フィールド欠落のruntime inputを予約・再開・競合判定の入口で検証する。
- 拒否は安定したmachine-readable errorとし、reservation ledger、resource state、外部作用を変更しない。
- 有効な入力の既存挙動と、snapshot／port経由の入力契約を維持する。

## 受入条件

- [ ] null系入力は確約処理より前に拒否され、対象ledgerと既存reservation bytesが不変である。
- [ ] エラーに入力欠落の位置と安定codeが含まれ、再試行しても二重確約や部分書込みが起きない。
- [ ] null系のnegative testと有効入力のregression testをfocused testへ追加する。

## 検証と完了

レビュー追補の登録のみ。新Spec、実装、テスト、review、PR、CI、mergeは未着手である。
