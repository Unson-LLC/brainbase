---
story_id: story-t0-initial-tenant-slack-oauth-bootstrap
spec_status: accepted
---

# 初期Slack接続bootstrap仕様

## 初期管理者manifest

既存`human-company-authority.v1`を使い、`humans`は正確に1件、`tenant_role`は`tenant_admin`、`login_role`は`ceo`または`gm`とする。tenant、project、Graph organizationは既存正本と完全一致させる。Slack workspace/app、canonical person ID、login grant、membership payloadは通常の人員登録と同じ値を使う。

## 初期管理者登録

- checkはmanifest検証だけを行う。
- dry-runはtransaction内で計画とreadbackを作り、必ずrollbackする。
- applyは`--approve-apply`と`BRAINBASE_PROVISIONING_ACTOR`を要求し、commit後に別DB接続でreadbackする。
- workspace connectionおよびcompany external identityは参照・作成しない。

## OAuth開始

- `--authorize`は`--approve-authorize`と`BRAINBASE_PROVISIONING_ACTOR`を要求する。
- active tenant、tenant project、Graph organization、tenant organization、person、auth grant、tenant membershipをtransaction-local tenant contextで完全一致検証する。
- app IDは本番設定とmanifestをDB接続前に一致検証し、workspace/appは署名stateへ固定してcallback交換時にSlack応答と一致検証する。
- 検証後、既存control planeへ新しい`insi_` ID、tenant ID、期待workspace ID、app ID、初期管理者person IDを渡す。
- intent保存は管理者再検証と同じDB transactionを使い、URL生成失敗を含む途中失敗ではrollbackする。
- 返却可能なのはstateを内包するauthorization URL、redirect URI、intent IDだけとする。state単体、secret、token、code、credential materialは含めない。

## 本番の続き

本人同意後のcallbackがworkspace connectionとcredential refを登録する。その後、通常のhuman authority provisionerで初期管理者と実利用者を完全登録し、external identityを含むcommit後readbackを行う。
