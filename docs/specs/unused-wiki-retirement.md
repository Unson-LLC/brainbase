# 未使用Wikiの実行経路除去

## 契約

1. `/api/wiki`の既存一覧・ページ・manifest・pull・書込みは410の明示的な退役応答。WikiServiceを呼ばない。
2. `brainbase wiki sync|pull|push|status`は退役エラーで終了し、認証ファイル読取、fetch、ファイル生成をしない。
3. Wiki service/controllerおよびbootstrap注入を除去。portalのWiki由来direction/frame/storiesは未提供を明示し、他のportalデータ取得を保持する。
4. MCPのWiki専用tool/resourceの広告と取得実装を除去。旧名・URIを直接呼んでもWiki APIへ接続しない。Graph検索等を変更しない。
5. Slack OAuthログイン、発行済みセッション/アクセストークンの仕組みは変更しない。Google等の業務連携OAuthをログイン方式と混同しない。

## 検証

- HTTP各method/pathが410、偽Wiki serviceの全呼出し0。
- CLI各操作の拒否とfetchなし。
- portalのWiki読取りなし、既存catalog/access境界の維持。
- MCP広告/旧tool/旧resourceの退役テスト。
- Slackログイン対象テスト、関連bootstrap/learningテスト。

## 境界と復旧

コードのみ。データ移行・削除・本番切替はしない。Git revertでコードを戻せる。コード到達可能性は実利用の証拠ではない。
