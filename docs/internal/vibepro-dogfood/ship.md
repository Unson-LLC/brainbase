# VibePro Brainbase Dogfood Ship Evidence

## Story

- Story: `STR-vibepro-brainbase-dogfood`
- Status: shipped
- Shipped at: 2026-04-26

## Scope Shipped

Brainbase 上で VibePro の評価分離 dogfood を成立させた。

実装済みの loop:

```text
observe -> generate-diagnosis -> generate-outcome -> generate-labels -> score
```

## Acceptance Evidence

| Acceptance Criterion | Evidence |
|---|---|
| `observation.json` が機械観測の snapshot として保存される | `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260426-011234/observation.json` |
| `diagnosis.json` は VibePro の診断判断だけを保存し、正解ラベルを含まない | `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260426-011234/diagnosis.json` |
| `outcome.json` は観測事実から機械生成され、診断結果に依存しない | `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260426-011234/outcome.json` |
| `labels.json` は `outcome.json` と `diagnosis.json` の照合で機械生成される | `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260426-011234/labels.json` |
| `score.json` は日本語指標を決定論的に計算する | `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260426-011234/score.json` |
| `feedback.md` と `report.md` は採点結果から生成される | `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260426-011234/feedback.md`, `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260426-011234/report.md` |

## Control-Plane Evidence

- VibePro score evidence check CI: `.github/workflows/vibepro-score-run.yml`
- Graph SSOT check CI: `.github/workflows/vibepro-graph-ssot.yml`
- Graph SSOT check script: `scripts/vibepro-graph-ssot-check.mjs`
- VibePro score runner: `scripts/vibepro-score-run.mjs`
- GitHub Actions運用正本: `docs/guides/github-actions-cicd-operating-guide.md`
- Active indicator tmux spinner fallback run: `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260506-111000-active-indicator-tmux-spinner/development-run.md`
- Active indicator stale spinner guard run: `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260506-202900-active-indicator-stale-spinner-guard/development-run.md`
- Session status sort contract run: `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260506-204100-session-status-sort-contract/development-run.md`
- Score evidence advisory workflow run: `docs/internal/vibepro-dogfood/runs/vibepro-brainbase-20260506-212000-score-evidence-advisory-workflow/development-run.md`

## Latest Score

Run: `vibepro-brainbase-20260426-091011`

- 本番化ギャップ捕捉率: not_applicable
- 本番化ギャップ的中率: not_applicable
- ゲート違反流出率: 0
- 観測 fact 数: 0

## Graph SSOT Evidence

`npm run vibepro:graph-ssot` passed against `https://bb.unson.jp`.

Verified:

- `frm_vibepro`
- `本番化ギャップ捕捉率`
- `本番化ギャップ的中率`
- `ゲート違反流出率`
- `dec_vibepro_ai_self_evaluation_metrics_japanese_ssot`
- automation scope Brainbase Philosophy Context

## Residual Risks

- Early dogfood runs were backfilled as archival runs so the run directory is complete. They remain historical experiment evidence; `vibepro-brainbase-20260426-091011` is the canonical closure run.
- CI artifact runs do not evaluate repository-local historical run completeness; repository-local dogfood runs do.
