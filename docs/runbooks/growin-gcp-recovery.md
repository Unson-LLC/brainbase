# Growin専用Brainbase GCP復旧手順

## 原則

- DBマイグレーションは前進修正とし、適用前のCloud SQLバックアップと任意時点復旧を維持する。
- API・MCPは、障害発生前に確認済みのコンテナイメージへ戻す。
- Terraformの `rollback_git_sha` は、今回のリリースSHAとは別の確認済み旧安定版を指定する。
- パイロット期間中の認証状態はAPIプロセス内に保持するため、Cloud Run再起動中の認証は失敗し得る。利用者は認証を最初からやり直す。複数インスタンス化の前に共有状態ストアへ移行する。

## 切り戻し

1. Cloud RunのAPI・MCP、マイグレーションJob、認証登録Jobの最新revision・execution・ログを保存する。
2. TerraformでAPI・MCPのimageを旧安定版へ戻す計画を作り、置換・削除がないことを確認して適用する。
3. `/health/ready`、未認証時401、Growin専用MCPの会議準備ケースを再確認する。
4. DB起因で前進修正できない場合だけ、Cloud SQLの任意時点復旧で別インスタンスを作り、件数とテナント境界を照合してから接続先を切り替える。元DBは削除しない。

## 実行と照合

```bash
gcloud run services describe brainbase-api --region=asia-northeast1 --project=brainbase-505912
gcloud run services describe brainbase-mcp --region=asia-northeast1 --project=brainbase-505912
gcloud run jobs executions list --job=brainbase-migrate --region=asia-northeast1 --project=brainbase-505912
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="brainbase-migrate" AND textPayload:"INFO_SSOT_APPLY_RECEIPT"' --limit=10 --project=brainbase-505912
```

旧イメージへ切り替えるTerraform planは `0 destroy` を必須とする。適用後は `scripts/growin/verify-remote-e2e.sh` が成功し、未認証MCPが401、他案件の候補が0件であることを確認する。

## 証跡

- `brainbase-migrate` のCloud Loggingにある `INFO_SSOT_APPLY_RECEIPT` を保存する。
- Terraform plan/applyの件数、Cloud Run execution名、E2E結果を同じ作業記録へ残す。
- 秘密値、OAuthクライアントシークレット、Bearer tokenは記録へ貼らない。
