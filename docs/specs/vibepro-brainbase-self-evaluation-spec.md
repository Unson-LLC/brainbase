---
spec_id: SPEC-vibepro-brainbase-self-evaluation
title: VibePro Brainbase dogfood評価分離仕様
source_story: docs/stories/vibepro-brainbase-dogfood-story.md
source_architecture: docs/architecture/vibepro-brainbase-dogfood-architecture.md
status: accepted
created_at: 2026-04-25
updated_at: 2026-04-27
---

# SPEC-vibepro-brainbase-self-evaluation

## 1. 正本

| 対象 | 正本 |
|---|---|
| VibePro思想 | Brainbase Graph `frame: frm_vibepro` |
| 日本語指標 | Brainbase Graph `frm_vibepro.core_metrics` |
| run保存先 | `docs/internal/vibepro-dogfood/runs/<run_id>/` |

## 2. run構成

```text
docs/internal/vibepro-dogfood/runs/<run_id>/development-run.json
docs/internal/vibepro-dogfood/runs/<run_id>/development-run.md
docs/internal/vibepro-dogfood/runs/<run_id>/observation.json
docs/internal/vibepro-dogfood/runs/<run_id>/diagnosis.json
docs/internal/vibepro-dogfood/runs/<run_id>/outcome.json
docs/internal/vibepro-dogfood/runs/<run_id>/labels.json
docs/internal/vibepro-dogfood/runs/<run_id>/score.json
docs/internal/vibepro-dogfood/runs/<run_id>/feedback.md
docs/internal/vibepro-dogfood/runs/<run_id>/report.md
```

## 3. development-run.json

自立開発 loop の trace。Story -> Architecture -> Spec -> Test -> Code -> Run evidence を接続する。

```json
{
  "run_id": "vibepro-brainbase-yyyymmdd-hhmmss-topic",
  "target_project": "brainbase",
  "frame_id": "frm_vibepro",
  "run_type": "autonomous_development_loop",
  "status": "completed|completed_with_residual_risk|failed",
  "request": {
    "raw": "string",
    "interpreted_goal": "string"
  },
  "story": {
    "namespace": "vibepro-dogfood/topic",
    "story_key": "vibepro-dogfood/topic/yyyyMMdd-topic",
    "acceptance_criteria": ["string"]
  },
  "implementation": {
    "jj_change_id": "string",
    "commit_id": "string",
    "description": "string",
    "changed_files": ["string"]
  },
  "verification": {
    "passed": [
      {
        "command": "string",
        "result": "passed",
        "tests": "string"
      }
    ],
    "failed_or_blocked": []
  },
  "outcome": {
    "loop_result": "success|targeted_success|failed",
    "residual_risks": ["string"],
    "next_actions": ["string"]
  },
  "development_dag": {
    "nodes": {
      "requirement": {
        "status": "passed|failed|skipped",
        "evidence": ["request.raw"]
      },
      "story": {
        "status": "passed|failed|skipped",
        "depends_on": ["requirement"],
        "evidence": ["docs/stories/vibepro-brainbase-dogfood-story.md"]
      },
      "architecture": {
        "status": "passed|failed|skipped",
        "depends_on": ["story"],
        "evidence": ["docs/architecture/vibepro-brainbase-dogfood-architecture.md"]
      },
      "spec": {
        "status": "passed|failed|skipped",
        "depends_on": ["architecture"],
        "evidence": ["docs/specs/vibepro-brainbase-self-evaluation-spec.md"]
      },
      "test_design": {
        "status": "passed|failed|skipped",
        "depends_on": ["spec"],
        "evidence": ["tests/unit/..."]
      },
      "implementation": {
        "status": "passed|failed|skipped",
        "depends_on": ["test_design"],
        "evidence": ["changed file path"]
      },
      "verification": {
        "status": "passed|failed|skipped",
        "depends_on": ["implementation"],
        "evidence": ["test command"]
      },
      "run_evidence": {
        "status": "passed|failed|skipped",
        "depends_on": ["verification"],
        "evidence": ["docs/internal/vibepro-dogfood/runs/<run_id>/development-run.json"]
      },
      "score_gate": {
        "status": "passed|failed|skipped",
        "depends_on": ["run_evidence"],
        "evidence": ["npm run vibepro:development-dag"]
      },
      "ship": {
        "status": "passed|failed|skipped",
        "depends_on": ["score_gate"],
        "evidence": ["docs/internal/vibepro-dogfood/ship.md"]
      }
    },
    "residual_risk_recovery": {
      "previous_residual_risk_count": 0,
      "recovered_count": 0
    }
  }
}
```

`development-run.md` は同じ内容を人間レビュー用に要約する派生文書。

`development_dag.nodes` は `requirement`, `story`, `architecture`, `spec`, `test_design`, `implementation`, `verification`, `run_evidence`, `score_gate` を必須とする。`ship` と `residual_risk_recovery` は任意だが、`status: completed` の run では `ship` が `passed` でなければならない。

## 4. observation.json

機械観測 snapshot。診断結果を読まずに生成する。

```json
{
  "run_id": "vibepro-brainbase-yyyymmdd-hhmmss",
  "target_project": "brainbase",
  "frame_id": "frm_vibepro",
  "observed_at": "ISO-8601",
  "repo": {
    "branch": "develop",
    "upstream": "origin/develop",
    "ahead": 0,
    "behind": 0,
    "changed_files": [
      {
        "path": "string",
        "status": "string",
        "category": "vibepro_dogfood|unrelated|skill|other"
      }
    ]
  },
  "observed_facts": [
    {
      "fact_id": "fact.repo.behind_origin",
      "kind": "operational_freshness",
      "severity": "medium",
      "summary": "develop is behind origin/develop",
      "evidence": ["string"]
    }
  ]
}
```

## 5. diagnosis.json

VibePro の診断判断。正解ラベルは含めない。

```json
{
  "run_id": "string",
  "status": "diagnosed",
  "detected_gaps": [
    {
      "gap_id": "gap.brainbase.example",
      "title": "string",
      "severity": "high|medium|low",
      "category": "string",
      "evidence_fact_ids": ["fact.repo.behind_origin"],
      "recommended_route": "string",
      "gate_required": false
    }
  ]
}
```

## 6. outcome.json

観測事実から機械生成される事後アウトカム。診断結果を読まない。

```json
{
  "run_id": "string",
  "status": "generated",
  "actual_gaps": [
    {
      "actual_gap_id": "actual.gap.repo.behind_origin",
      "fact_ids": ["fact.repo.behind_origin"],
      "severity": "medium",
      "category": "operational_freshness",
      "reason": "string"
    }
  ],
  "gate_violations": [],
  "intervention_outcomes": []
}
```

## 7. labels.json

`outcome.json` と `diagnosis.json` の照合結果。LLMが直接書かない。

```json
{
  "run_id": "string",
  "status": "generated",
  "actual_gaps": [
    {
      "actual_gap_id": "actual.gap.repo.behind_origin",
      "matched_detected_gap_id": "gap.brainbase.repo.behind-origin",
      "judgment": "true_positive|missed"
    }
  ],
  "gate_violations": [],
  "intervention_outcomes": []
}
```

## 8. 指標

### 本番化ギャップ捕捉率

```text
matched actual gaps / actual_gaps
```

### 本番化ギャップ的中率

```text
detected gaps matched by actual_gaps / detected_gaps
```

### ゲート違反流出率

```text
escaped gate violations / gate_violations
```

ゲート違反が0件の場合は `0` とする。

### 開発DAG合致率

```text
passed required development DAG nodes / required development DAG nodes
```

### 証跡欠落率

```text
required development DAG nodes without evidence / required development DAG nodes
```

### ゲート前進違反率

```text
passed nodes with failed or missing dependencies / passed development DAG nodes
```

passed node が0件の場合は `0` とする。

### 残リスク回収率

```text
recovered previous residual risks / previous residual risks
```

前回残リスクがない、または計算に必要な証跡がない場合は `not_applicable` とする。

### Story-to-Ship閉鎖率

```text
ship node passed ? 1 : 0
```

`status: completed` の run で `Story-to-Ship閉鎖率` が `1` でなければ gate failed とする。`completed_with_residual_risk` は `residual_risks` と `next_actions` が残っていれば許可する。

## 9. CLI

```bash
node scripts/vibepro-doc-trace-check.mjs
node scripts/vibepro-development-dag-check.mjs
node scripts/vibepro-development-dag-check.mjs check-run <run-dir>
node scripts/vibepro-score-run.mjs observe <run-dir>
node scripts/vibepro-score-run.mjs generate-outcome <run-dir>
node scripts/vibepro-score-run.mjs generate-labels <run-dir>
node scripts/vibepro-score-run.mjs score <run-dir>
node scripts/vibepro-score-run.mjs run <run-dir>
node scripts/vibepro-score-run.mjs auto-run <run-dir>
node scripts/vibepro-score-run.mjs gate <run-dir>
```

`vibepro-doc-trace-check.mjs` は `docs/internal/vibepro-dogfood/runs/` の差分がある時に、同じ差分内で Story / Architecture / Spec の正本更新を要求する。
`vibepro-development-dag-check.mjs` は 2026-04-27 以降の新しい dogfood run で `development-run.json` と `development_dag` を要求し、開発DAG指標の gate を判定する。
`run` は `generate-outcome -> generate-labels -> score` を順に実行する。
`auto-run` は `observe -> diagnosis/outcome/labels/score/feedback/report` をまとめて生成する。
`gate` は日本語指標を判定し、流出してはいけない違反を検出する。

## 10. 受け入れ条件との接続

| Story AC | Spec |
|---|---|
| run が Story -> Architecture -> Spec に追跡可能 | 3 |
| `observation.json` が機械観測 | 4 |
| `diagnosis.json` が正解ラベルを含まない | 5 |
| `outcome.json` が診断非依存 | 6 |
| `labels.json` が機械生成 | 7 |
| 日本語指標を決定論的計算 | 8 |
| feedback/report生成 | 9 |
| 新しい dogfood run が開発DAG証跡を持つ | 3, 8, 9 |
| 開発DAGの欠落・順序違反・証跡欠落で止まる | 8, 9 |
