# 判断基盤の公開provider境界

目的・Variable・Model・Constraintは既存Graph Foundation catalogに保存する。哲学は既存正本のrevision readerを使い、Foundation型や別の哲学保存先へ複製しない。

共通の公開入口は`foundation-public-provider`。MCPの`createServer({ foundation })`とHTTPの`createFoundationPublicRoute`が同じproviderを使う。Hostは毎回の認証からprincipal・tenant/project scopeを解決し、canonical storeとphilosophy readerを注入する。リクエスト本文に認証情報を持たせない。

- Foundation読取は特定revision、digest、identityと現在のACLを確認する。
- 判断参照検証は標準Foundation providerに委譲し、Objective/Modelの依存参照検証を迂回しない。
- 哲学は専用revision resolverを必ず通す。接続がなければ未解決を返す。
- 過去の判断の閲覧では現在のACLと正本digestを検証し、当時の適用条件を現在の条件で上書きしない。
- provider未設定時にMCP toolsを公開しない。直接呼び出しても未接続エラーになる。

Organizationは認証、tenant scope、canonical providerの接続・運用を所有する。Unsonに独自の判断規則を追加しない。HTTPの`scope_id`はHostが認証済みgrantと照合するルーティング入力であり、権限の根拠ではない。

過去Ontologyのversion定義は書き換えず、Foundation公開契約を版付き拡張として返す。コード・テストの成立と、本番に接続済みであることは別に記録する。配備前の段階でOntologyへの型名追加だけを本番接続の証明にしない。
