---
story_id: STR-vibepro-brainbase-dogfood
title: BrainbaseでVibeProの評価分離dogfoodを回す
source_requirement:
  requirement_title: "BrainbaseでVibeProを試す"
architecture_docs:
  - path: docs/architecture/vibepro-brainbase-dogfood-architecture.md
    status: accepted
status: shipped
created_at: 2026-04-25
updated_at: 2026-04-26
---

# STR-vibepro-brainbase-dogfood: BrainbaseでVibeProの評価分離dogfoodを回す

## 背景

VibePro の思想は Brainbase Graph SSOT の `frm_vibepro` を正本とする。

初回の最小実験では、診断、正解ラベル、採点、自己フィードバックの流れは成立した。ただし、正解ラベルを LLM が作っていたため、keiba / FX のような「判断」と「事後評価」の分離には届いていなかった。

## 誰が

Brainbase / VibePro の運用者として。

## 何を

VibePro の診断結果を、独立した観測事実と事後アウトカムで採点できるようにしたい。

## なぜ

AI が自分で自分の診断を正解化すると、本番化ギャップ捕捉率や本番化ギャップ的中率が自己都合の数字になる。AI が安全に自走するには、診断と正解ラベルを分離し、採点だけは決定論的に行う必要がある。

## 受け入れ基準

- [x] `observation.json` が機械観測の snapshot として保存される
- [x] `diagnosis.json` は VibePro の診断判断だけを保存し、正解ラベルを含まない
- [x] `outcome.json` は観測事実から機械生成され、診断結果に依存しない
- [x] `labels.json` は `outcome.json` と `diagnosis.json` の照合で機械生成される
- [x] `score.json` は日本語指標を決定論的に計算する
- [x] `feedback.md` と `report.md` は採点結果から生成される

## Ship 証跡

- `docs/internal/vibepro-dogfood/ship.md`

## スコープ外

- 外部顧客への VibePro 提供
- 本番データ移行、本番切替、顧客通知
- UI 実装
- Graph / NocoDB への run 履歴永続化

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・誰が・何を・なぜ・受け入れ基準のみ。
