---
story_id: story-t0-slack-installation-failure-diagnostics
spec_status: accepted
---

# Slack installation非秘密failure diagnostic仕様

## Ledger契約

既存相関キー`installation_intent_id`、`tenant_id`、`request_digest`と`attempt`を利用し、failed rowへ次を追加する。

- `failure_stage`: `oauth_exchange | exchange_normalize | connection_reserve | credential_store | db_register`
- `failure_code`: allowlist済みstable code
- `cleanup_status`: `not_needed | revoked | failed`

成功・再claim時は診断列をnullへ戻す。過去のfailed rowはnullのまま残し、後付け分類しない。

## 安定コード

- OAuth (`oauth_exchange`): `UPSTREAM_UNAVAILABLE | OAUTH_EXCHANGE_UNAVAILABLE | OAUTH_EXCHANGE_INVALID | OAUTH_EXCHANGE_REJECTED | OAUTH_CREDENTIAL_MISSING | OAUTH_EXCHANGE_FAILED`
- normalize (`exchange_normalize`): `UPSTREAM_UNAVAILABLE | WORKSPACE_CONNECTION_INVALID | WORKSPACE_CONNECTION_CONFLICT | EXCHANGE_NORMALIZATION_FAILED`、それ以外は`EXCHANGE_NORMALIZATION_FAILED`
- reservation (`connection_reserve`): `UPSTREAM_UNAVAILABLE | INSTALLATION_STATE_INVALID | INSTALLATION_BINDING_MISMATCH | INSTALLATION_STATE_REPLAYED | INSTALLATION_STATE_EXPIRED | INSTALLATION_CLAIM_STALE | INSTALLATION_IN_PROGRESS | WORKSPACE_CONNECTION_STALE_REVISION | CONNECTION_RESERVATION_FAILED | TENANT_UNKNOWN | CONTRACT_UNAVAILABLE`、それ以外は`CONNECTION_RESERVATION_FAILED`
- credential store (`credential_store`): `UPSTREAM_UNAVAILABLE | CREDENTIAL_REF_INVALID | CREDENTIAL_STORE_UNAVAILABLE | CREDENTIAL_STORE_INVALID | CREDENTIAL_STORE_REJECTED | CREDENTIAL_STORE_FAILED`、それ以外は`CREDENTIAL_STORE_FAILED`
- DB registration (`db_register`): `UPSTREAM_UNAVAILABLE | INSTALLATION_CLAIM_STALE | WORKSPACE_CONNECTION_STALE_REVISION | TENANT_UNKNOWN | CONTRACT_UNAVAILABLE | DB_REGISTRATION_FAILED`、それ以外は`DB_REGISTRATION_FAILED`

任意の`.code`は信用せず、既存ContractErrorまたは固定adapter messageだけを変換する。public routeは従来どおりstable codeだけを返し、ledger diagnosticを含めない。

## Cleanup契約

credential ref取得前は`not_needed`。取得後の下流失敗でrevokeが成功した場合は`revoked`、revokeが失敗または結果不明なら`failed`。credential ref自体は保存しない。

## 保存禁止

raw authorization code、access/refresh token、credential ref、provider response body、例外message/stack、secret URLをledger/readbackへ保存しない。

## Composed local受入経路

local acceptance testはproduction bootstrapからrouteを組み立て、bootstrap→human/service auth・CSRF→authorize/exchange→OAuth adapter→credential-store adapter→PostgreSQL failure ledger readbackを単一経路で実行する。operator readbackの現行受入境界は`MultitenantPostgresRepository.readSlackInstallationFailureDiagnostic`によるrepository-level確認とし、public diagnostic API/UIは追加しない。

## 証跡境界

本仕様のテストはlocal contract/code evidenceである。production接続、same-run readback、過去のgeneric rowの原因、T0 Exit Gate完了を証明しない。
