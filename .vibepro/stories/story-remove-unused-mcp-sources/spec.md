# 未使用MCP sourceの除去

## Outcome
MCP利用者は現行Graph SSOT経路を継続利用でき、廃止済みfilesystem/hybrid取得実装を保守・再利用する余地を残さない。

## 受け入れ条件
1. `server.ts` のGraphAPISource経路、Core ontology、検索契約を変えない。
2. 内部の本番callerがないFilesystemSource/HybridSourceと専用parser・専用テスト・ParsedFile型・専用gray-matter依存を除去する。共有依存は残す。
3. filesystem/hybrid設定の拒否テストを維持する。現役Story/Specの旧parser維持要件は退役として更新し、歴史資料は保持する。
4. package typecheck、Graph/config/ontologyの影響テスト、対象Playwright契約テストを通す。

## 確認範囲と境界
repo内と隣接local repoに本番consumerなし。packageはexports制限がなく外部deep importの不在は断定できない。公開packageのpublish・外部データ削除・本番反映は含めない。STATE_PATH、NocoDB、履歴やGraphデータは変更しない。
