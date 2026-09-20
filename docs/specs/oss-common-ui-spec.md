# Spec: OSS共通UIパッケージ境界

## 配置

`ui/` はブラウザで直接利用できるES moduleとCSSを保持する。ホストはAPI関数、利用者・プロジェクト文脈、DOM rootを注入し、UIは認証tokenや保存層へ直接接続しない。

## 公開契約

- `@unson/brainbase-mcp/ui/outcome-knowledge`
- `@unson/brainbase-mcp/ui/outcome-mana`
- 対応するCSSと `ui/icons/*`

組織版はこれらを依存として利用し、組織固有のshell、組織切替、権限、承認、監査、外部接続だけを追加する。

## 不変条件

- `unknown` を空や成功へ変換しない。
- mutation後のreadback契約を維持する。
- 顧客名、organization ID、URL、秘密、brandingを含めない。
- OSS機能を組織版で削除しない。
