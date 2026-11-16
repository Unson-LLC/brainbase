---
story_id: story-world-memory-status-v1
title: 世界に記憶の状態と「整理できなかった夜」を出す
status: in_progress
created_at: 2026-10-11
implementation_started: true
owner_repository: brainbase
---

# 世界に記憶の状態と「整理できなかった夜」を出す

## 利用者成果

世界を開く本人として、昨夜の記憶の整理がどうなったかと、自分が決めるべき記憶の候補があるかを、ルーティン専用の画面やレポートを開かずに知りたい。候補があれば、そこから「候補の確認」へ降りたい。

## 背景

- brainbase-project の前提台帳は 2026-10-11 に P18 を足した。朝・夜・週のルーティンは専用の画面を持たず、結果を世界と既存の画面に出す。世界には記憶の状態（整理した記憶・候補・未確認）と、整理できなかった夜を出す。
- OSS Personal には夜の整理の結果を受け取る置き場が無い。P9 に従い、出せないものは「未接続」と出し、0件で埋めない。
- 組織版は本番の正本APIから、夜の整理の受領記録と本人の記憶の候補を読める。

## 受入条件

- [ ] AC-01: 世界の部品は `memoryStatus()` を受け取る。答えは `{ status, night?, candidates?, review_href? }` で、`night.status` は `completed`・`partial`・`failed`・`missing`。
- [ ] AC-02: `memoryStatus` が渡されない、または `status: 'not_connected'` のとき、「記憶の整理：未接続」と出し、候補の件数を0件とは出さない。
- [ ] AC-03: 夜の整理が `failed`・`missing` のとき「整理できなかった夜」と目立たせる。`partial` は「一部だけ」と出す。
- [ ] AC-04: 候補が1件以上あれば「あなたが決める記憶の候補 N件」と出し、`review_href` があれば「候補の確認を開く」のリンクを付ける。リンクは `https:` と画面の中のリンク（`/`・`?`）だけを通す。
- [ ] AC-05: 読めなかった部分（`night`・`candidates` が null、または読み取りの失敗）は「読めない」と出し、0件とは出さない。
- [ ] AC-06: キャンバス表示と標準表示の両方で同じ内容を出す。

## 範囲外

- 組織版で `memoryStatus` を渡すこと（brainbase-organization の別の変更）。
- 整理した記憶の件数（夜の整理の受領記録に件数が無いため。受領記録へ件数を足すのは別の変更）。
