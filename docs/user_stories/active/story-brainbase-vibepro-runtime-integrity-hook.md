---
story_id: story-brainbase-vibepro-runtime-integrity-hook
title: Pin Brainbase push judgments to the canonical VibePro npm runtime
architecture_docs:
  - path: docs/architecture/vibepro-runtime-integrity-hook-architecture.md
    status: active
related_tasks:
  - task_source: VibePro
    task_ids: [TASK-vibepro-runtime-integrity-hook]
status: active
created_at: 2026-08-11
updated_at: 2026-08-11
---

# Brainbase push判断をcanonical VibePro runtimeへ固定する

## 背景

Brainbaseのpush hookは、PATHや公式npm packageを使わず、古いGit checkoutの
`/Users/ksato/workspace/code/vibepro/bin/vibepro.js` を直接実行していた。そのcheckoutは
公開runtimeと独立して古くなり得るうえ、CLIが見つからない場合やJSONを解析できない場合に
fail-openしていた。

## 変更内容

- shell pre-pushとClaude Code pre-tool hookを同じruntime contract validatorへ接続する。
- validatorはcanonical launcherだけを起動し、exact npm version、source commit、npm source kind、
  clean/published relation、trusted integrity、identity digestを検証する。
- runtime identityが不明・古い・dirty・想定外なら、PR判断やpushを継続しない。
- `pr prepare` のruntime identityが事前検証したidentityと同じdigestであることを確認する。

## 受け入れ基準

- [ ] 両hookから古いVibePro source checkoutの絶対パス参照がなくなる。
- [ ] 両hookが同じ `.claude/scripts/hooks/lib/vibepro-runtime-contract.mjs` validatorとcanonical launcherを使う。
- [ ] 公開済み `vibepro@0.2.0-beta.5`、source commit
  `5e19da4a890a6ae607241d40bbbb438dae6f5124` 以外を拒否する。
- [ ] dirty Git runtime、missing/invalid identity、`pr prepare` identity mismatchをfail-closedで拒否する。
- [ ] 通常hook実行時に `exact_version`、`source_git.commit`、`identity_digest` を報告できる。
- [ ] validatorのunit testと、公開npm runtimeを使ったverify/PR smokeを残す。

## スコープ外

- VibePro package自体のruntime integrity実装。
- VibeProのnpm publish処理。
- 既存の成果コード、Spec、Critical reviewの再生成。
