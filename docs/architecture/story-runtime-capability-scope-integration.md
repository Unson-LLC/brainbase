# Architecture: 実行権限と接続スコープの分離

## 決定

実行可否を表すCompany Authority capabilityと、外部接続が保持すべきOAuth scopeを同じ配列で扱わない。tenant context producerからrepositoryまで両者を別フィールドで伝播する。

## 不変条件

- `required_capabilities`はcanonical Company Authorityだけで評価する。
- `required_connection_scopes`は対象workspace connectionだけで評価する。
- `runtime.execute`をSlack OAuth scopeとして要求しない。
- 接続スコープ不足はfail closedにする。

## 展開順序

1. 修正をdevelopへPRで統合する。
2. Phase 0.2 migrationを適用する。
3. API/MCPを同じmerge SHAで展開する。
4. 本番readbackとdry-runを行い、Batch 2 Applyは別承認とする。
