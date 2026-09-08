# Architecture: 別事業体の実利用者プロビジョニング

## 境界

人、ログイン許可、テナント所属、外部IDは異なる状態であり、一つの「登録済み」へ集約しない。単一manifestを入力にしても、各行を個別に検証・保存・readbackする。会社権限bindingはA0の権限cutoverで別途宣言する。

## 書込みモデル

1. transaction開始後にtenantをlockし、`set_config('brainbase.tenant_id', tenant_id, true)`でRLSを固定する。
2. tenant revision、tenant project、Graph organization、同一tenantのactive Slack workspace connectionを正規IDで検証する。
3. `tenant_organizations`はtenant内IDを使い、Graph正本のorganization IDをpayloadへ保持する。
4. `auth_grants`はSlackログイン、`tenant_memberships`はtenant所属、`company_external_identities`は外部主体として別々に保存する。
5. membership payloadにもSlack user/workspace、project、clearanceを保持し、既定のログインresolverがcanonical tenant/personへ解決できるようにする。
6. 既存行は完全一致ならnoop、不一致・複数候補ならrollbackする。external identityはstatusに関係なく最大revisionを求め、active候補だけを別に数えて古いactive行を見落とさない。
7. `dry-run`は同じSQL経路を実行してrollbackし、`apply`だけcommitする。apply後はpoolから再取得した接続で独立transactionを開始し、全状態を再読込する。

## IDと秘密境界

stable IDはtenantと各自然キーのcanonical JSONから導出する。Slack token、client secret、authorization codeはmanifestに含めず、検出時は入力を拒否する。

## 事業体分離

`organization_id=techknight`は既にUnson tenantが所有しているため、TechKnight tenantでは`org_techknight_business`を使う。これはGraph組織を複製する意味ではなく、tenant-scoped runtime recordとGraph SSOTのID空間を分けるための識別子である。
