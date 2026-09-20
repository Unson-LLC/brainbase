# Spec: legacy organization authority bridge

`legacy-organization-authority-bridge.v1` manifestでcanonical tenant、Graph organization、Graph project、既存Slack principalを宣言する。

処理は既存active auth grantを読み、person、organization、workspace、project codeの包含を検証する。grant自体は更新しない。検証後、`tenant_projects`、`tenant_organizations`、`tenant_memberships`を同一transactionで作成または完全一致確認する。

```bash
node scripts/provision-legacy-organization-authority-bridge.js --manifest <path> --check
node scripts/provision-legacy-organization-authority-bridge.js --manifest <path> --dry-run
BRAINBASE_PROVISIONING_ACTOR=<actor> node scripts/provision-legacy-organization-authority-bridge.js --manifest <path> --apply --approve-apply
```

競合する既存projection、複数grant、Graph ownership不一致は安全側で停止する。秘密情報はmanifestへ含めない。

apply後の独立readbackは新しいtransactionを開始し、manifestのcanonical tenantをtransaction-localなRLS contextへ設定してから正本を読む。readback成功後にcommitし、途中失敗時はrollbackする。tenant contextなしで空に見えたRLS保護行を、欠損や適用失敗として扱わない。

正規organizationとは別に、同じtenantへ属する旧`organization_id`行がすでに存在する場合、その行をresolverの別名として再利用する。正規organizationへ同じ値の`graph_organization_id`を追加するとresolver候補が二重になるため更新しない。別tenantに同じ旧IDがある場合は競合として停止する。
