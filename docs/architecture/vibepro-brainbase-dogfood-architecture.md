---
adr_id: ADR-vibepro-brainbase-dogfood
title: Brainbase VibePro dogfoodの評価分離アーキテクチャ
source_story:
  story_id: STR-vibepro-brainbase-dogfood
  path: docs/stories/vibepro-brainbase-dogfood-story.md
status: proposed
created_at: 2026-04-25
updated_at: 2026-04-25
---

# ADR-vibepro-brainbase-dogfood: 評価分離アーキテクチャ

## 決定

Brainbase 上の VibePro dogfood は、keiba / FX と同様に、判断経路と評価経路を分離する。

```text
observation -> diagnosis -> outcome -> labels -> score -> feedback/report
```

## 責務境界

| レイヤー | ファイル | 責務 | LLM関与 |
|---|---|---|---|
| 観測 | `observation.json` | git / test / Graph / workflow などの機械観測 snapshot | なし |
| 診断 | `diagnosis.json` | VibePro が本番化ギャップを仮説診断する | あり得る |
| アウトカム | `outcome.json` | 観測事実から事後確定した実ギャップを生成する | なし |
| 正解ラベル | `labels.json` | `outcome` と `diagnosis` を fact id で照合する | なし |
| 採点 | `score.json` | 日本語指標を決定論的に計算する | なし |
| 学習 | `feedback.md` / `report.md` | 採点結果を次回改善に投影する | なし |

## 正本

| 対象 | 正本 |
|---|---|
| VibePro思想 | Brainbase Graph `frame: frm_vibepro` |
| VibePro指標 | Brainbase Graph の日本語指標 |
| dogfood契約 | `docs/specs/vibepro-brainbase-self-evaluation-spec.md` |
| run証跡 | `docs/internal/vibepro-dogfood/runs/<run_id>/` |

## 原則

- `diagnosis.json` は正解ラベルを書かない
- `labels.json` を LLM が直接書かない
- 正解ラベルは `outcome.json` から決定論的に生成する
- 診断と正解の接続は `fact_id` で行う
- 採点は本番化ギャップ捕捉率、本番化ギャップ的中率、ゲート違反流出率を日本語名で出す

## keiba / FX からの対応

| keiba / FX | VibePro dogfood |
|---|---|
| 市場データ / レース結果 / 確定平均足 | `observation.json` / `outcome.json` |
| 判定DAG | `diagnosis.json` |
| バックテスト / フォワード整合チェック | `score.json` |
| ROI / DD / 合致率 | 本番化ギャップ捕捉率 / 本番化ギャップ的中率 / ゲート違反流出率 |

## 却下した案

### LLMが診断と正解ラベルを同時に作る

却下。自己採点バイアスが残り、指標がAI自走の判断材料にならない。

### レポートだけを成果物にする

却下。人間には読みやすいが、AIが自分の判断を後から比較できない。
