---
story_id: story-remote-judgment-hook-contract-sync-v1
status: accepted
---

# Spec: Remote Judgment Hook contract sync

## CL-001 Orphan Stop passthrough

remote requestのdispatcherがcanonical Hostのorphan Stop修復blockを返した場合、HTTP adapterは`status: 200`、`accepted: true`、`hook_event_name: Stop`、canonical `output`を返す。`output.decision`は`block`でなければならず、reasonは`judgment_episode_not_found`を含む。

- Code: `mcp/brainbase/src/remote-judgment-hook-http.ts`
- Test: `mcp/brainbase/tests/auth/remote-judgment-hook-http.test.ts`

## CL-002 Missing tool identity

Brainbase `PostToolUse`に`tool_use_id`がない場合、canonical Hostのreason `judgment_tool_use_id_missing`をHTTP `503` errorへ写像する。

- Code: `scripts/codex-hooks/judgment-resolver-host.mjs`
- Test: `mcp/brainbase/tests/auth/remote-judgment-hook-http.test.ts`

## CL-003 Empty audit output

dispatcherがPostToolUseの監査出力を返さない場合、HTTP adapterは`503`と`judgment_hook_audit_not_recorded`を返す既存契約を維持する。

- Code: `mcp/brainbase/src/remote-judgment-hook-http.ts`
- Test: `mcp/brainbase/tests/auth/remote-judgment-hook-http.test.ts`

## CL-004 Scope

変更対象はremote HTTP回帰テストとStory/Architecture/Spec/Task文書だけとし、本番コードは変更しない。
