---
story_id: story-outcome-context-protected-origin-path
title: Mana成果発行を保護済みprivate runtimeパスへ接続する
status: active
created_at: 2026-09-21
updated_at: 2026-09-21
spec_docs:
  - path: docs/specs/story-outcome-context-protected-origin-path.md
    status: final
---

# Mana成果発行を保護済みprivate runtimeパスへ接続する

## User Story

管理画面の利用者として、Manaへの安全な業務依頼がCloudflareの経路境界で530にならず、Brainbaseが認証・権限確認した成果コンテキストを使って隔離実行されてほしい。

## Acceptance Criteria

- Manaからbridgeへの契約は`POST /v1/outcome-service-context:issue`のまま維持する。
- bridgeは対象要求だけを保護済みの`POST /api/v1/runtime/outcome-service-context:issue`へ転送する。
- private listenerは保護済みパスで既存のservice authと成果コンテキスト発行器を使用する。
- 他のcanonical runtime routeと既存の`/v1`互換経路の振る舞いを変更しない。
- 本番の安全テストで530を解消し、外部副作用なしの隔離成果を読み戻せる。
