---
name: brainbase-claude-hooks-の-tsx-実行は-node-esbuild-のcpuアーキテクチャ不
description: Claude hooks の tsx 実行は Node/esbuild のCPUアーキテクチャ不一致で全フックがノイズ化する
---

# brainbase-claude-hooks-の-tsx-実行は-node-esbuild-のcpuアーキテクチャ不

## Trigger
- Use when this pattern appears: Claude hooks の tsx 実行は Node/esbuild のCPUアーキテクチャ不一致で全フックがノイズ化する

## Steps
- node -p "process.arch" && uname -m
- which node npm npx && file $(which node)
- file /usr/local/bin/node 2>/dev/null
- ls node_modules/@esbuild/
- cd /Users/ksato/workspace/code/brainbase
- rm -rf node_modules/esbuild node_modules/@esbuild
- PATH=/Users/ksato/.nvm/versions/node/v22.22.0/bin:$PATH npm install --no-audit --no-fund
- ls node_modules/@esbuild/  # darwin-arm64 を確認
- PATH=/Users/ksato/.nvm/versions/node/v22.22.0/bin:$PATH node -e "require('esbuild').transformSync('const x = 1', {})"

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/claude-hooks-の-tsx-実行は-node-esbuild-のcpuアーキテクチャ不

## Source
- Promoted from explicit_learn / success