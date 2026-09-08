# 個人KGのMana・Codex接続

この手順は本人専用の登録・検索を有効にする。組織KGへの昇格は、既存の本人承認と組織側レビューを別に実行する。

## 本人の対応付けと権限

Slackの表示名やモデルが指定した人物IDから本人を決めない。既存の `company_external_identities` と有効な `tenant_memberships` が、Slack workspace・app・userを一意の本人へ対応付ける。未登録、曖昧、失効した対応付けは拒否し、佐藤さんや管理者へ代替しない。

有効化対象者ごとに、既存の [本人操作権限の手順](../specs/story-human-company-action-authority-provisioning.md) で次の2権限を宣言する。

| 操作 | capability_id | allowed_effects | resource_ref |
| --- | --- | --- | --- |
| 本人の検索 | personal_read | read | personal://本人のcanonical person ID/notes |
| 本人の登録 | personal_write | write | personal://本人のcanonical person ID/notes |

人物・所属・外部identity・配置の既存値を確認してmanifestへ記入する。人物情報の新規登録と操作権限の付与は別の作業であり、推測値で埋めない。

```sh
node scripts/provision-human-action-authority.js --manifest <本人ごとの確認済みmanifest> --check
node scripts/provision-human-action-authority.js --manifest <本人ごとの確認済みmanifest> --dry-run
```

本番への適用は対象と差分を確認して承認後に行う。CLIの `persisted` は権限保存の証拠であり、Manaからの検索成功を意味しない。

## Manaの通信境界

Brainbaseのサービス認証に加えて、company authorityの署名・期限・配置・組織・本人・用途・対象resourceを検証する。署名検証キーと配置は既存のcompany authority設定を使う。本文の `owner_person_id` や `organization_id` で認証済みの本人を上書きできない。

共有チャンネル、グループDM、利用者を特定できない起動では個人KGを公開しない。本人のSlack DMだけに登録・検索を提供する。取得した記憶を共有面へ自動転送しない。

### 個人KGのforwarder操作

`BRAINBASE_TENANT_PROVIDER_FORWARDERS_JSON` は、既存の `bb.unson.jp` audienceを残したまま、同じaudienceの `operations` に次の2項目を追加する。次のJSONは `operations` の追加分であり、既存の `provider`・`base_url`・operationを置き換えない。

```json
{
  "brainbase.personal_knowledge.search": {
    "method": "POST",
    "path": "/api/personal-knowledge/search",
    "body_encoding": "json",
    "response_encoding": "utf8",
    "credential_placement": "none",
    "allow_binding_provider_mismatch": true,
    "service_bearer_env": "BB_PERSONAL_KG_SERVICE_JWT"
  },
  "brainbase.personal_knowledge.register": {
    "method": "POST",
    "path": "/api/personal-knowledge/events",
    "body_encoding": "json",
    "response_encoding": "utf8",
    "credential_placement": "none",
    "allow_binding_provider_mismatch": true,
    "service_bearer_env": "BB_PERSONAL_KG_SERVICE_JWT"
  }
}
```

`BB_PERSONAL_KG_SERVICE_JWT` には、このBrainbase API向けに発行したproject-scoped service JWTを設定する。forwarderはこのJWTをサービス認証として付けるだけで、本人や組織を決めない。リクエスト本文には、既存のcompany authorityで署名した `company_authority_response` を含める。Personal KG APIはその署名を検証して本人・組織・DM・用途を確定する。検索結果はJSON配列をUTF-8文字列として返すため、呼出し側は `body` をJSONとして読み取る。接続失敗や署名検証失敗時に別の保存先へ切り替えない。

## 反映後の受入

1. 本人AのDMからテスト用の短い個人記憶を登録する。
2. 本人Aの同じDMで検索し、登録IDと本文を読み戻す。
3. 本人BのDMから同じ語で検索し、Aの記憶が出ないことを確認する。
4. 共有チャンネルとグループDMでは個人KGの登録・検索が拒否されることを確認する。
5. 別人ID、別組織、期限切れ署名、read権限による登録を拒否することを確認する。
6. Codexの各保存先で登録・再起動・検索を確認する。接続失敗はエラーとして返り、別の保存先へ切り替わらないことを確認する。

結果は、コード検証・本番反映・権限保存・本人DMの読戻しを分けて記録する。HTTP 200やCI成功だけで社員展開完了にしない。

## ローカルの実DB検証

使い捨てPostgreSQLを使い、superuserでもBYPASSRLSでもない接続で登録・検索を検証する。

```sh
PERSONAL_KNOWLEDGE_TEST_TMPDIR=<テスト用ディスクのディレクトリ> npm run test:run -- tests/server/services/personal-knowledge-client-isolation.integration.test.js
```

`PG_BIN_DIR` にPostgreSQLのbinを指定できる。CIでは `PERSONAL_KNOWLEDGE_CLIENT_DATABASE_URL` に専用の使い捨てDBを指定する。実運用DBは指定しない。

## Codexの保存先

`BRAINBASE_PERSONAL_KG_STORAGE_MODE` に `local` または `managed_cloud` を指定し、対応するAPI URLも必ず指定する。

| 保存方式 | 必須のURL設定 | 接続条件 |
| --- | --- | --- |
| local | `BRAINBASE_PERSONAL_KG_LOCAL_API_URL` | loopbackのBrainbase API |
| managed_cloud | `BRAINBASE_PERSONAL_KG_MANAGED_CLOUD_API_URL` | HTTPSのBrainbase API |

本人として認証したトークンで、同じ `/api/personal-knowledge/events` と `/api/personal-knowledge/search` を使う。サービス用トークンだけでは本人の代わりに利用できない。URLに認証情報やクエリを含めず、転送先への自動リダイレクトも許可しない。

`local` は接続先の選択であり、loopbackの先がクラウドDBへのトンネルでないことを保証しない。利用開始前に、そのAPIのDB接続先が本人のローカルDBであることを確認する。保存方式の変更による既存データの移行・同期は行わない。

保存方式未設定では、既存の `search_personal_kg` の候補検索を維持する。新しい登録経路は保存方式を設定するまで利用できない。既存候補が新しいイベント保存先へ移行済みだとは扱わない。
