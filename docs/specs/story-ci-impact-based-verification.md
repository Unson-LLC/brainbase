# 変更対象に応じたCI検証とリリース証明 Spec

## 不変条件

### INV-001: ドキュメントPRの重複検証を避ける

`docs/**`だけのPull Requestでは、docs契約、公開契約テスト、VitePress build、built HTML smokeを実行する。パッケージworkflowのbuildと完全テストは重複実行しない。

### INV-002: パッケージPRは実際の完全テスト集合を検証する

パッケージ関連Pull Requestでは、Node 22で`npm run build`と`npm test`を完了し、Node 20で`npm run test:integration`を完了する。`npm test`は現行のVitest収集（`tests/npm-prepublication-evidence.integration.test.ts`だけを除外した181ファイル）を対象とする。

### INV-003: Node契約を代表実行で確認する

`package.json`の`engines.node >=20`に対応し、Node 20の代表統合スイートとNode 22の完全パッケージスイートをCIで実行する。

### INV-004: 公開証明を短縮しない

npm公開はimmutable commit、artifact、validation proof、provenance、npm/GitHub Releaseのreadbackを既存のrelease workflowで確認する。docsのdevelop pushは、対象入力を限定してもCloudflare deployと`docs:verify-public`を維持する。

### INV-005: 失敗時の未確認を残す

各workflowは失敗またはキャンセル時に、保護対象、再現コマンド、期待結果、未確認の状態を`GITHUB_STEP_SUMMARY`へ記録する。自動retryや失敗状態の成功扱いは行わない。

## 実装アンカー

- パッケージCI: `.github/workflows/test.yml`
- ドキュメントCIと公開後readback: `.github/workflows/docs-cloudflare-pages.yml`
- npm artifact/proof/provenance: `.github/workflows/npm-publish.yml`
- public-message review PR: `.github/workflows/public-message-promotion.yml`
- 責務と運用: `docs/guides/github-actions-cicd-operating-guide.md`
