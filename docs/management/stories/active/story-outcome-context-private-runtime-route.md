---
story_id: story-outcome-context-private-runtime-route
title: Manaの成果コンテキスト発行をprivate runtimeへ接続する
status: active
created_at: 2026-09-21
updated_at: 2026-09-21
spec_docs:
  - path: docs/specs/story-outcome-context-private-runtime-route.md
    status: final
---

# Manaの成果コンテキスト発行をprivate runtimeへ接続する

## User Story

管理画面の利用者として、Manaへの安全な業務依頼がCloudflare Tunnelの転送先で404にならず、Brainbaseが認証・権限確認した成果コンテキストを使って実行されてほしい。

## Acceptance Criteria

- loopback限定のtenant runtime listenerが`POST /v1/outcome-service-context:issue`を提供する。
- private listenerは公開listenerと同じservice authと成果コンテキスト発行器を使用する。
- 発行器が未構成のときは503、不正なservice tokenは401でfail closedする。
- 既存の`/api/v1/runtime`契約と公開listenerの振る舞いを変更しない。
- 本番private listenerで対象パスが404ではなく認証境界へ到達する。
