---
story_id: story-t0-slack-installation-failure-diagnostics
status: accepted
---

# Slack installation失敗診断アーキテクチャ

## 境界

Slack OAuth callback の公開応答と、運用者向けの内部診断台帳を分離する。公開 route は既存の安定したエラー契約だけを返し、段階別診断は tenant と installation intent で限定した repository readback からのみ取得する。

## 書込み経路

`SlackInstallationControlPlane.exchange_and_register` は OAuth exchange、正規化、connection reservation、credential store、DB registration の順に進める。失敗時は現在の段階を allowlist 済み code に変換し、例外 message、stack、authorization code、token、credential ref、upstream body を保存しない。

stable code allowlist は実装と同期し、全段階で `UPSTREAM_UNAVAILABLE` を許容する。`credential_store` ではこれに加えて `CREDENTIAL_REF_INVALID` を許容し、各段階のその他の値は段階固有の fallback（`OAUTH_EXCHANGE_FAILED`、`EXCHANGE_NORMALIZATION_FAILED`、`CONNECTION_RESERVATION_FAILED`、`CREDENTIAL_STORE_FAILED`、`DB_REGISTRATION_FAILED`）へ閉じる。

credential ref を取得する前の失敗は cleanup `not_needed` とする。opaque ref 取得後の下流失敗だけを revoke し、明示的な成功 receipt は `revoked`、失敗または不明は `failed` とする。

## 読戻し経路

`PostgresRepository.readSlackInstallationFailureDiagnostic` は tenant と intent の組を必須にし、request digest、attempt、stage、stable code、cleanup だけを返す。公開 Slack installation route と tenant runtime provider-forward route は、この内部 read model を公開しない。

## 共有 credential adapter の互換性

Slack installation は `createRemoteCredentialStore` の `ContractError(CREDENTIAL_STORE_*)` を段階別診断へ利用する。一方、tenant runtime の `createRemoteCredentialMaterializer` は従来の plain Error 境界へ戻し、`/provider-requests:forward` の公開応答を `500 / INTERNAL_ERROR` のまま維持する。

## 検証境界

単体・route契約・schemaテストで段階分類、秘密非保存、cleanup、公開応答互換を固定する。実 PostgreSQL integration で failed write/readback と冪等 migration を確認する。これらは local evidence であり、production OAuth、credential store round trip、deploy、same-run UsageEvent/OperationReceipt readback の証拠にはしない。
