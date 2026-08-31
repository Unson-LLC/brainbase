---
name: project-provisioning
description: Brainbaseへ新規プロジェクトを正式登録するときに、Manifest確認からPlan、Apply、Verify、Resumeまでを安全に実行する。
---

# Project Provisioning

## 目的

プロジェクト立ち上げを場当たり的なファイル編集にせず、サーバー側の `ProjectProvisioningService` を唯一の実行本体として扱います。このSkillはCLIを選び、結果を確認する薄い入口です。

## When to Use

- 新しい顧客・社内・製品プロジェクトをBrainbaseへ登録するとき
- 途中失敗した登録を状態とReceiptから再開するとき
- Project Registry、Graph、権限の登録結果を検証するとき

## 実行手順

1. Manifestを作り、`local_path`を入れない。
2. `check`で衝突を確認する。この操作は書き込みを行わない。
3. `plan`のManifestと全差分を確認する。すべてのPlanに`manifest_plan_approval` Human Gateが付く。
4. Bearer認証された担当者が、基礎承認と追加Gateを過不足なく`approve`し、review ref付きの不変Receiptを保存する。
5. `apply`を実行し、`verify`でRegistry・Graph・Grant・Repositoryの実読戻しReceiptを確認する。
6. `partial_failed`なら原因を直して`resume`する。完了済みstepは再実行しない。プロセス終了で`applying`に残ったrunは、5分経過後に`resume`が原子的に再取得する。
7. `active`になった後で、必要ならConnected-world Onboardingを別途開始する。

## コマンド例

```bash
brainbase project provision check --manifest project.json
brainbase project provision plan --manifest project.json --idempotency-key customer-2026-001
brainbase project provision approve ppr_xxx --gates manifest_plan_approval,repository_create --review-ref review-001
brainbase project provision apply ppr_xxx
brainbase project provision status ppr_xxx
brainbase project provision verify ppr_xxx
brainbase project provision resume ppr_xxx
```

すべてのPlanはManifestと差分全体の`manifest_plan_approval`を必須とします。`repository.mode=create`、公開リポジトリ、CEO権限などの広い変更は追加Gateとして表示されます。`approve`はPlanに必要な項目を過不足なく指定し、`apply`とは別に実行します。CLIのローカルフラグを承認Receiptの代用にはしません。

## 境界

- Project Provisioning: project code、Registry、Graph、Auth Grant
- Repository Bootstrap: GitHub repositoryの作成
- Workspace Setup: 個人の`local_path`やclone先
- Connected-world Onboarding: Drive、議事録、既存コンテンツ

詳細契約は `docs/brainbase-capabilities/capabilities/project.provisioning.yml` を参照してください。

## Common Rationalizations

- 「小さな案件だから直接SQLでよい」: 小さくてもRegistry・Graph・Grantの不整合は残るため、必ずPlanを通す。
- 「途中まで成功したので最初からやり直す」: 完了済みstepを消さず、同じrunを`resume`する。
- 「`applying`を手動で書き換える」: 実行中runと競合するため禁止。5分のstale判定を待って`resume`する。
- 「ローカルclone先もManifestへ入れる」: 個人番地はWorkspace Setupで扱い、組織のManifestへ入れない。

## Red Flags

- `check`でDB・Graph・GitHubへの書き込みが発生している。
- Human Gate対象なのに`review_ref`がない。
- `partial_failed`を`active`として報告している。
- production E2E未実施なのに本番登録済みと報告している。

## Verification

```bash
brainbase project provision status ppr_xxx
brainbase project provision verify ppr_xxx
```

`active`、`verified: true`、全stepの`completed`、Repository readback、Auth GrantのJWT更新要求を個別に確認します。取得不能や未実施は成功へ丸めません。
