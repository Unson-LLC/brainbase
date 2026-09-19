# Brainbase境界整理の仕様

Story: `brainbase-boundary-cleanup`

## Portal

- Graph取得成功・0件はGraph由来の空一覧。失敗・未構成・不正な取得形式は取得不能とし、件数を0と断定しない。
- Portalの他セクションは引き続き返す。Storyの取得状態をメタデータで識別できること。
- WikiはGraphに存在するStoryの補足文書のみ。Graphの識別子・状態・受入条件をWikiの値で補完しない。NocoDBのマイルストーン投影とは区別する。

## Mesh

- `/api/mesh`配下は既存の`requireAuth`で保護し、insecure role/projectヘッダーを認証に使わない。
- MCPの既存TokenProviderからBearer tokenを取得する。無関係なツールへのディスパッチではトークン取得しない。
- queryは指定ノードへの送信のみ。`status: sent`とqueryIdは相手の受信・回答・保存を証明しない。説明とレスポンスはその制限を明示する。
- `all`、空白だけの入力、不正scopeを送信しない。
- 機械クライアント向けCSRF例外が必要なら、認証必須のPOST `/api/mesh/query`のBearerに限定する。cookieのみのリクエストには通常のCSRF検証を残す。
- `MESH_OWNER_PERSON_ID`と`MESH_OWNER_ORGANIZATION_ID`を明示設定し、検証済みの人間用JWT/cookieの本人・組織と完全一致する場合だけ利用を許可する。未設定は503、別人・別組織・汎用サービス資格情報は403。役割がCEOでも所有者照合を省略しない。
- 受信側の権限検証は維持する。ただし現行relayの申告と暗号化だけでは送信者本人を検証できないため、受信者自身の権限を使わず権限0・空projectで拒否する。本人を検証するプロトコルが実装されるまでローカル文脈を開示しない。

## 退役能力

- `codex.app-server`は退役済みの短い記録とし、ADR-019の実行場所の責任分離、Run Receiptへの移行を示す。
- 現行surfacesとdepends_onに旧UI/プロセスを登録しない。過去の経緯は履歴参照としてのみ残す。

## 検証

- Portal: Graphあり／成功空／例外／未構成／不正形式、WikiだけのStoryが復活しないこと。
- Mesh: 匿名・偽装ヘッダー拒否、正規認証、送信入力検証、受付と回答の区別、MCP token伝搬、CSRF境界。
- YAML: retiredを維持し、旧実装の復旧を指示せず、検証コマンドが存在すること。
