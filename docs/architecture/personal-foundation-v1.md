# 個人基盤 v1：共通契約

PR brainbase-unson#1742 の初回実装契約。既存記憶の移行・再分類は行わない。

## コンテキスト

`PersonalKnowledgeContext` は `{ contract_version: 1, scope, owner_person_id, organization_id, source_id }`。
`scope` は `personal_owned` または `organization_private`。
前者の `organization_id` は null、後者は空でない組織ID。
本人IDとsource_idは空でない文字列。source_idは永続化した正本識別子であり、URLや一時プロセスIDではない。
同一正本の判定は全フィールドの一致で行う。本人・組織は認証由来であり、本文で指定できない。

## API

既存の `/api/personal-knowledge/events` と `/api/personal-knowledge/search` は維持する。
新契約は `X-Brainbase-Personal-Context-Version: 1` による明示的な選択で提供する。
v1では登録結果 `{ context, event }`、検索結果 `{ context, results }` を返す。
`GET /api/personal-knowledge/context` は本人認証、同じパスのPOSTはManaの署名済みCompany Authorityを用いたread操作に対応する。
コンテキスト応答は `{ context }`。本文・秘密値を含めない。
v1クライアントは保存・検索前に期待するcontextと接続先のcontextを照合し、操作応答でも一致を確認する。
期待するcontextは信頼した端末設定・接続設定から読み、モデル入力には置かない。
サーバーも操作時に認証・所属・領域を再検証する。期待コンテキストの提示は認可の代わりにならない。
v1の登録・検索には `X-Brainbase-Personal-Context` ヘッダーで期待contextのJSONをUTF-8/base64url符号化して送る。
サーバーは認証由来のcontextと完全一致する場合だけ処理する。不正・欠落・不一致は書込み前に拒否する。
context確認APIにはこの期待ヘッダーを必須にせず、認証された本人のcontextだけを返す。

## ローカルと組織

OSSはOSユーザーが所有する永続領域とstdio MCPを初回の提供方式とし、新しいHTTP待受やWebログインを作らない。
本人・source_idを初期化時に永続化し、再起動で変更しない。データ領域は既存personal-os配下の独立した新規領域。
`createLocalPersonalKnowledgeStore` とMCPのlocalモードは `personal_owned` 専用であり、組織の代替保存先にはならない。
HTTPクライアントの `mode: 'local'` は別の用途で、開発・結合試験用のloopback API接続だけを許可する。
これはOSSのファイル保存や組織からのfallbackを実装するものではない。組織の通常利用は `managed_cloud` に固定する。
組織版は管理型の明示的な新規領域だけをv1へ接続し、既存イベントを自動的にv1検索へ含めない。
共有・昇格・削除のAPIは今回追加しない。組織管理者に本人本文への権限を追加しない。

## 不変条件

- 再試行は同じevent_idと同じ内容なら同じイベントを返し、同じIDで内容が違えば拒否する。
- 別人・別組織・別source_idを混ぜない。接続不調時の別領域へのfallbackを禁止する。
- localとmanaged_cloudは接続方式であり、所有範囲や移行・同期を意味しない。
- 管理型クライアントはHTTPS、redirect拒否、失敗の明示を維持する。テスト用HTTPは明示的なloopback限定。
- Webはcontextと接続結果だけを表示する。全利用者のWebログインを必須にしない。
- 認証・所属・署名の検証をモックした試験を実Slack/Codexでの受入完了としない。
