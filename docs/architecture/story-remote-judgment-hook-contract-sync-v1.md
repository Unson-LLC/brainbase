---
story_id: story-remote-judgment-hook-contract-sync-v1
title: Remote Judgment Hook contract sync architecture
status: accepted
---

# Architecture: Remote Judgment Hook contract sync

## Decision

既に正本化・マージ済みのHost契約を変更せず、remote HTTP境界の回帰テストを現在のcanonical outputへ同期する。

orphan Stopはcanonical Hostが生成したone-shot修復blockをremote transportが成功応答としてruntimeへ渡す。これは監査成功ではなく、最終回答を有限回で修復するための制御出力である。対して、Brainbase `PostToolUse`の`tool_use_id`欠損は対象eventを安全に束縛できないため、具体的なreasonを保ったterminal failureとする。

## Contract mapping

```text
orphan Stop
  canonical Host: decision:block + repair instruction
  remote HTTP: 200 accepted + output passthrough

Brainbase PostToolUse without tool_use_id
  canonical Host: judgment_tool_use_id_missing
  remote HTTP: 503 + exact safe error reason

empty dispatcher PostToolUse output
  remote HTTP: 503 + judgment_hook_audit_not_recorded
```

## Safety boundary

- `200 accepted`は監査完了を意味しない。output内の`decision:block`を維持する。
- raw session/turn ID、回答本文、tool input/output、secretを新たにassertionへ固定しない。
- production code、authority guard、Hook lifecycleを変更しない。

## Verification

- remote HTTP focused suiteで3契約を直接検証する。
- rootの`test:judgment-resolution`でHost unit/integration、remote境界、knowledge監査をまとめて回帰確認する。
- independent reviewで、成功偽装と本番コード変更がないことを確認する。
