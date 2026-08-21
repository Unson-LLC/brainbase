# Story: 実行権限と接続スコープの本番履歴統合

## 利用者価値

Brainbase運用者として、Company Authority上の実行権限とSlack workspaceの接続スコープを混同せず、tenant contextを正しく発行できる本番状態を、developの追跡可能な履歴として維持したい。

## 背景

本番には`d849d699`の認可修正が先行適用されているが、developには未統合である。この状態でdevelopをデプロイすると修正が消えるため、Phase 0.2の展開を安全に進められない。

## 受け入れ条件

- [x] AC-001: tenant context要求は事業上の`required_capabilities`と接続上の`required_connection_scopes`を別フィールドで伝播する。
- [x] AC-002: Company Authority resolverは実行権限をcanonical authorityで検証し、接続スコープをworkspace connectionで独立して検証する。
- [x] AC-003: `runtime.execute`をSlack OAuth scopeとして要求しない回帰テストと、不正な接続スコープを拒否するテストが通る。
- [x] AC-004: 本番先行commitの内容をdevelop最新へ競合なく統合し、既存のGraph Maintenance Phase 0.2変更を保持する。

## 非対象

- 認可モデルの新規設計
- Graph Entity/Edgeの変更
- Batch 2 Apply
