# Growin専用Brainbase GCP復旧手順

## 原則

- DBマイグレーションは前進修正とし、適用前のCloud SQLバックアップと任意時点復旧を維持する。
- API・MCPは、障害発生前に確認済みのコンテナイメージへ戻す。
- Terraformの `rollback_git_sha` は、今回のリリースSHAとは別の確認済み旧安定版を指定する。

## 切り戻し

1. Cloud RunのAPI・MCP、マイグレーションJob、認証登録Jobの最新revision・execution・ログを保存する。
2. TerraformでAPI・MCPのimageを旧安定版へ戻す計画を作り、置換・削除がないことを確認して適用する。
3. `/health/ready`、未認証時401、Growin専用MCPの会議準備ケースを再確認する。
4. DB起因で前進修正できない場合だけ、Cloud SQLの任意時点復旧で別インスタンスを作り、件数とテナント境界を照合してから接続先を切り替える。元DBは削除しない。

## 証跡

- `brainbase-migrate` のCloud Loggingにある `INFO_SSOT_APPLY_RECEIPT` を保存する。
- Terraform plan/applyの件数、Cloud Run execution名、E2E結果を同じ作業記録へ残す。
- 秘密値、OAuthクライアントシークレット、Bearer tokenは記録へ貼らない。
