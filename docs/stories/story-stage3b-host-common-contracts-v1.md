# 段3b: ホスト差し込み型の共通契約を公開する

## Story

組織固有の認証・保存・接続先を持つBrainbaseホストが、個人向けOSSの検証済み共通処理を利用し、同じ入力をローカルで再現できるようにする。これにより、local MCP、knowledge event、mesh、Honcho、onboardingの意味規則をUnson側へ複製せず、host portだけを差し込める。

## 範囲

- `@unson/brainbase-mcp/knowledge-event` にイベントの必須フィールド、正規化、冪等性・競合判定を公開する。
- `@unson/brainbase-mcp/mesh` にネットワークを起動しない封筒、ノード、query receiptの契約を公開する。
- `@unson/brainbase-mcp/honcho` にURL、workspace、HTTP requestの正規化を公開する。認証情報は受け取らない。
- `@unson/brainbase-mcp/onboarding-runtime` にsource receipt、permission snapshot、first valueの境界を公開する。保存とpromotionはhostへ委譲する。
- `@unson/brainbase-mcp/mcp-runtime` にlocal stdio MCPとtool receiptの契約を公開する。

## 境界

OSSは純粋な契約検証と決定的な整形だけを担当する。個人identity、organization/tenant、認証、secret、DB、relay、Honcho接続、Graphへの書込み、公開packageのversion更新はこのStoryの実装対象外であり、hostから差し込む。

Unsonのconsumerは候補packageをlocal packで検証できるようにするが、未publish packageを本番依存へ切り替えない。publish、live cutover、production readback、人間の受入は別の承認境界である。

## 完了条件

- 5つの公開subpathがpackage exportと型定義から読み込める。
- 不正なtimestamp、digest、URL、permission snapshot、MCP receiptを拒否する。
- 同じknowledge eventの再送は同じidentity、異なるidentityは競合として判定できる。
- Unson側のconsumer候補がlocal packの実装を使って、現行host側の同等入力・失敗境界を検証できる。
- local test/buildの成功をproduction readbackやpublish済みとは表現しない。
