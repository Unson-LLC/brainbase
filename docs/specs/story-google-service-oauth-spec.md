# Spec: Google service OAuth connection

## API契約

認証済み利用者向けの開始入口は `GET /api/auth/google/start?service=<id>` とする。
既存Meet入口 `GET /api/auth/google/meet/start` は後方互換のため残す。callbackは
`GET /api/auth/google/meet/callback` を共通利用し、署名済みstateの `service` がある場合は
サービス別接続へ、ない場合は既存Meet接続へ分岐する。

状態参照は `GET /api/auth/google/meet/status?service=<id>` とする。`service` 省略時は
既存Meet statusとし、controllerは認証トークンの `personId` と `organizationId` を必ず
repository filterに渡す。

## サービスとscope

| service | capability scope |
| --- | --- |
| `gmail` | `https://www.googleapis.com/auth/gmail.compose` |
| `google-calendar` | `https://www.googleapis.com/auth/calendar.readonly` |
| `google-drive` | `https://www.googleapis.com/auth/drive.readonly` |

OAuthのidentity scope (`openid profile email`) はアカウント照合用であり、サービスの
capabilityには含めない。

## 永続化と更新不変条件

- Googleサービス別接続は `integration_accounts.service = 'google'`、
  `scope_type = 'personal'` とし、`owner_person_id` と `org_id` の組で検索する。
- `metadata.google_services[service]` にそのサービスのscope配列と接続日時を保存する。
- `capabilities` は既存scopeとのunionとし、サービス追加で既存権限を落とさない。
- account/APIへ秘密値を投影しない。Googleサービス間で共有する物理credentialは、既存の
  Remote Credential Store adapter互換性を保つため provider `google-meet` のまま保存する。
  OAuth clientの参照値は `google-workspace` とし、UI上のサービスID（`gmail`、
  `google-calendar`、`google-drive`）とは分離する。
- token exchangeがrefresh tokenを返さない場合、credential store入力から
  `credential_refresh_material` 自体を省略し、既存refresh tokenを保持する契約に委ねる。

## セキュリティ境界

- service allowlist外は開始・交換・statusのいずれも `unsupported_google_service` として拒否する。
- OAuth stateは一度だけconsumeし、stateに束縛されたserviceをcallbackで利用する。
- statusと接続は本人・組織の両方で絞り、他組織のaccountを返さない。
- Meetは従来の `google-meet` accountとrefresh必須交換を維持する。

## 検証

- provider: 各サービスのscope、redirect、allowlist、refreshなしtoken exchange。
- connection service: 共有account、scope union、refresh入力省略、秘密値非開示、tenant status。
- routes: stateへのservice束縛、callback分岐、person/organization status。
- 既存Google Meet route/provider/state testsを同時に実行する。
