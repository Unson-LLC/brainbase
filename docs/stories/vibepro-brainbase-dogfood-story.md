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
updated_at: 2026-05-07
---

# STR-vibepro-brainbase-dogfood: BrainbaseでVibeProの自立開発dogfoodを回す

## 背景

VibePro の思想は Brainbase Graph SSOT の `frm_vibepro` を正本とする。

初回の最小実験では、診断、正解ラベル、採点、自己フィードバックの流れは成立した。ただし、正解ラベルを LLM が作っていたため、keiba / FX のような「判断」と「事後評価」の分離には届いていなかった。

その後の dogfood で、診断そのものよりも「要求から AI が安全に自立開発を進める制御面」が VibePro の主目的だと整理した。評価分離は主目的ではなく、自立開発DAGを止める・進めるための計器として扱う。

## 誰が

Brainbase / VibePro の運用者として。

## 何を

VibePro が要求から Story / Architecture / Spec / Test / Code / Run evidence / score まで自立的に進めたかを、独立した観測事実とDAG証跡で採点できるようにしたい。

## なぜ

AI が自分で自分の診断を正解化すると、本番化ギャップ捕捉率や本番化ギャップ的中率が自己都合の数字になる。さらに、診断だけが良くても Story / Architecture / Spec / Test / Code の順序を飛ばしていれば、自立開発としては危険である。AI が安全に自走するには、診断と正解ラベルを分離し、開発DAGの通過状況も決定論的に採点する必要がある。

## 受け入れ基準

- [x] `observation.json` が機械観測の snapshot として保存される
- [x] `diagnosis.json` は VibePro の診断判断だけを保存し、正解ラベルを含まない
- [x] `outcome.json` は観測事実から機械生成され、診断結果に依存しない
- [x] `labels.json` は `outcome.json` と `diagnosis.json` の照合で機械生成される
- [x] `score.json` は日本語指標を決定論的に計算する
- [x] `feedback.md` と `report.md` は採点結果から生成される
- [x] VibePro dogfood の各実装 run は、run 証跡だけでなく Story -> Architecture -> Spec のいずれかに追跡可能な形で残る
- [x] 前回 run の残リスクは、次 run の story_key / acceptance_criteria / verification に引き継がれる
- [x] 新しい VibePro dogfood run は、要求から score/gate までの開発DAG証跡を持つ
- [x] 開発DAG証跡は AI ではなく決定論的 checker で採点される
- [ ] 開発DAGが欠落・順序違反・証跡欠落を起こした場合、次工程へ進めない
- [ ] 日本語の開発DAG指標は Graph SSOT の用語として参照できる

## Ship 証跡

- `docs/internal/vibepro-dogfood/ship.md`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260427-110850-active-indicator/development-run.md`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260427-112222-runtime-harness/development-run.md`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260506-111000-active-indicator-tmux-spinner/development-run.md`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260506-202900-active-indicator-stale-spinner-guard/development-run.md`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260506-204100-session-status-sort-contract/development-run.md`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260506-212000-score-evidence-advisory-workflow/development-run.md`
- `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260507-135000-conversation-linker-load-shedding/development-run.md`

## スコープ外

- 外部顧客への VibePro 提供
- 本番データ移行、本番切替、顧客通知
- UI 実装
- Graph / NocoDB への run 履歴永続化

---

**ガードレール**: このファイルには仕様/実装詳細を書かない。背景・誰が・何を・なぜ・受け入れ基準のみ。
