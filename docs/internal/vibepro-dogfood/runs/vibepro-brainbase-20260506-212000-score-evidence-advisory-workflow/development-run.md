# VibePro Autonomous Development Run: Score Evidence Advisory Workflow

## Request

`俺もそれがいいと思うぞ。その形に直せ`

## Interpreted Goal

VibePro scorer を、PR全体を過剰に止める生成CIではなく、VibePro関連変更時だけコミット済み score evidence を非生成で検証する advisory workflow として接続する。

## Findings

- `score.json` を残すだけなら GitHub Actions は不要。
- workflow 接続の価値は、score生成ではなく採点漏れ・古いscore・gate違反を任意運用にしないこと。
- ただし全PR必須 gate や schedule auto-run は運用負荷が大きい。

## Implementation

- `scripts/vibepro-score-run.mjs` に `verify` / `verify-changed` を追加した。
- `npm run vibepro:score-verify` は changed run evidence だけを対象に、既存成果物を再計算結果と比較する。
- `.github/workflows/vibepro-score-run.yml` は VibePro関連 path 変更時だけ起動し、score成果物を生成しない。
- `_codex/common/ops/scheduled-jobs.md` から score workflow の schedule 記述を削除した。

## Verification

Passed:

- `npm -s exec vitest run tests/unit/vibepro-score-run.test.js --runInBand`
- `npm -s exec vitest run tests/unit/vibepro-score-run.test.js tests/unit/vibepro-development-dag-check.test.js tests/unit/vibepro-doc-trace-check.test.js --runInBand`
- `npx eslint scripts/vibepro-score-run.mjs scripts/vibepro-development-dag-check.mjs tests/unit/vibepro-score-run.test.js tests/unit/vibepro-development-dag-check.test.js`
- `npm run vibepro:score-verify`
- `npm run vibepro:development-dag`
- `npm run vibepro:doc-trace`
- `npm run vibepro:graph-ssot`

## VibePro Judgment

`go`.

`scorer-manual-only` は解消する。ただし、解決策は生成型CIや全PR必須 gate ではなく、対象限定・非生成・段階導入の evidence check とする。

## Residual Risks

- この workflow が required check になるかは GitHub branch protection 側の設定に依存する。このPRでは required 化しない。

## Next Actions

- false positive / 実行時間 / メンテ負荷を数PR観測してから required check 化の是非を判断する。
