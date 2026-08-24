# Story: Project Catalog対象をDecision business subjectとしてGraph Entity化する

## 利用者価値

Brainbaseの判断整理担当として、Project Catalogで正本化された案件をDecisionの業務対象へ安全に接続したい。これにより、認可scopeを変更せず、判断が何についてのものかをGraphで監査できる。

## 受け入れ条件

- Catalog Project IDとGraph Entity IDを同一に固定してProject型を生成できる。
- Catalog Projectの名称・版・参照元はサーバーが認証済み正本から解決し、呼び出し元の自己申告を採用しない。
- Decisionと同じ認可scopeへProjectの最小projectionを生成し、そのDecisionからProjectへ`governs`を作成できる。
- 生成と接続を一つのdry-run Planに含め、Apply前のDB変更は0件である。
- Human Gate、Plan/Apply Receipt、rollback、冪等性、read filteringを維持する。
- 既存のcross-tenant Product向け`link_decision_subject`契約を変更しない。
- Universal Arts 4判断で、追加対象以外の差分とbaseline違反増加が0件である。

## 本番適用前提

`brainbase-universal-arts-ai-support`がactive Project Catalogへ`name`と正の`catalog_version`付きで登録され、実行actorの認証grantに含まれていること。未登録・grant外の現在状態ではdry-runを403で安全停止し、Graph変更は0件とする。

## 非目標

- 任意型の汎用`create_entity`
- Project Catalog本文のGraph payloadへの複製
- `project_code`を業務上の所有関係として扱うこと
