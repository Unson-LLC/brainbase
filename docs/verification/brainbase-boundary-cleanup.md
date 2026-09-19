# 正本・認証・応答境界の整理：検証記録

日付: 2026-09-19
Story: [brainbase-boundary-cleanup](../stories/story-brainbase-boundary-cleanup.md)

## 確認した範囲

- PortalのGraph成功・空一覧・障害・未構成・不正応答を区別し、Wiki/NocoDBでStoryを復活させない。
- Mesh RESTは本人・組織が設定された所有者と一致する認証だけを許可する。匿名、偽装ヘッダー、サービス資格情報、別人・別組織は拒否する。
- MCPは既存TokenProviderを使用し、送信受付と回答取得を分離する。回答状態はunknown。
- 本人未確認の受信queryへローカル権限を貸さず、文脈収集前に拒否する。
- 廃止したCodex App Server能力は現行surfaceを持たず、履歴と現行Run Receiptへの参照を分ける。

## ローカル検証

| 検証 | 結果 |
| --- | --- |
| CIに登録したVitest 9ファイル（Portal/Mesh/旧runtime境界） | 78件成功 |
| 起動時配線・既存CSRF 4ファイル | 11件成功 |
| Mesh MCP node:test | 9件成功 |
| Codex退役契約 Playwright 2ファイル | 13件成功。ファイル契約でありブラウザー実動作ではない |
| Mesh MCP変更対象のTypeScript検査 | 成功 |
| MCP全体のTypeScript検査 | 未通過。ローカルの @huggingface/transformers 不足と関連型エラー |
| workflow YAML・参照テストパス、git diff --check | 成功 |

Vitest/Playwright/TypeScriptはNode 22.23.2で実行。MCP node:testは共有ローカル依存のesbuildアーキテクチャに合わせNode 26.3.1で実行した。CIはNode 22.23.2で依存を新規インストールして再検証する。

## 根拠と制約

Graph検索は認証エラーで本文を取得できていない。組織の最新判断は未確認であり、今回の判断はリポジトリのADR-019、コード、対象テストに基づく。

Graphifyの変更影響取得はpartial、freshness/impactはunknown、結果はtruncated。これを「影響なし」の根拠にせず、対象の呼び出し元と境界を直接確認した。

Meshの実ネットワーク送信、本番設定変更・デプロイ、ブラウザー上の実運用確認は実施していない。MESH_OWNER_PERSON_ID/MESH_OWNER_ORGANIZATION_IDが未設定なら503で拒否し、受信側の自動文脈開示も本人確認が整うまで拒否する。再開条件は[別Story](../stories/story-mesh-verified-sender.md)で扱う。

CI結果と独立レビューの最終結果はPRで追跡する。
