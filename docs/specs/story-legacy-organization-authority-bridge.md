# Spec: legacy organization authority bridge

`legacy-organization-authority-bridge.v1` manifestでcanonical tenant、Graph organization、Graph project、既存Slack principalを宣言する。

処理は既存active auth grantを読み、person、organization、workspace、project codeの包含を検証する。grant自体は更新しない。検証後、`tenant_projects`、`tenant_organizations`、`tenant_memberships`を同一transactionで作成または完全一致確認する。

```bash
node scripts/provision-legacy-organization-authority-bridge.js --manifest <path> --check
node scripts/provision-legacy-organization-authority-bridge.js --manifest <path> --dry-run
BRAINBASE_PROVISIONING_ACTOR=<actor> node scripts/provision-legacy-organization-authority-bridge.js --manifest <path> --apply --approve-apply
```

競合する既存projection、複数grant、Graph ownership不一致は安全側で停止する。秘密情報はmanifestへ含めない。
