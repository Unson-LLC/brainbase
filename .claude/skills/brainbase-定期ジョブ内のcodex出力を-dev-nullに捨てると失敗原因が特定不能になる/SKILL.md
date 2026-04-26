---
name: brainbase-定期ジョブ内のcodex出力を-dev-nullに捨てると失敗原因が特定不能になる
description: 定期ジョブ内のcodex出力を/dev/nullに捨てると失敗原因が特定不能になる
---

# brainbase-定期ジョブ内のcodex出力を-dev-nullに捨てると失敗原因が特定不能になる

## Trigger
- Use when this pattern appears: 定期ジョブ内のcodex出力を/dev/nullに捨てると失敗原因が特定不能になる

## Steps
- 避ける例:
- `codex exec ... >/dev/null 2>&1`
- 推奨例:
- `codex exec ... > "$LOG_DIR/codex.$id.out" 2> "$LOG_DIR/codex.$id.err"`
- 失敗時に記録する項目:
- `date`, `PATH`, `which codex`, `which node`, `node -p 'process.arch'`, exit code, stderr tail

## Guardrails
- Do not override the linked wiki rule.
- Escalate if the current case contradicts the wiki guidance.

## Linked Wiki
- architecture/定期ジョブ内のcodex出力を-dev-nullに捨てると失敗原因が特定不能になる

## Source
- Promoted from explicit_learn / success