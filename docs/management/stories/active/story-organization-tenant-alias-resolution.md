# Story: 認証組織から正規テナントを一意に解決する

Brainbaseの組織管理者として、ログイン情報のGraph組織IDから正規テナントを解決したい。これにより、正規のtenant organizationがcanonical IDで保存されていても、組織接続APIを安全に利用できる。

## 受け入れ条件

- canonical organization IDと`organization_payload.graph_organization_id`のどちらでもactive tenantを解決できる。
- Graph組織IDに複数のactive tenantが一致する場合は、どれも選ばず未解決を返す。
- 解決結果の`organization_id`は認証で要求された組織IDを返し、middlewareがtenantだけを補完できる。
- resolverの実行権限とRLS境界は維持する。
- Graph組織IDに複数のactive tenantが一致しても、認証済みperson・Slack user・Slack workspaceが同一のactive membershipとconnectionに一致する場合は、そのtenantだけを解決する。
- 本人・workspaceの情報が不足、不一致、または複数tenantに一致する場合は未解決を返す。
