---
story_id: story-noncyclic-outcome-authority-proof
title: Manaの権限証明を循環なしで検証する
status: active
created_at: 2026-09-21
updated_at: 2026-09-21
spec_docs:
  - path: docs/specs/story-noncyclic-outcome-authority-proof.md
    status: final
---

# Manaの権限証明を循環なしで検証する

## User Story

管理画面の利用者として、Manaへの安全な業務依頼がCloudflare Service Bindingの循環で失敗せず、永続化済み権限を検証したうえで実行されてほしい。

## Acceptance Criteria

- Manaが署名した60秒以内の権限証明だけをBrainbase bridgeが受理する。
- 証明は依頼のtenant、project、actor、contract、run、resource、operation、mode、profileに一致しなければならない。
- 不正・期限切れ・未知鍵は上流へ転送せずfail closedする。
- bridgeからManaへのService Bindingを廃止し、循環を作らない。
- 秘密鍵および証明自体はBrainbase Node runtimeへ転送しない。

