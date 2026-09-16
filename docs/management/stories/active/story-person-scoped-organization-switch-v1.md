# Story: 本人に付与された組織をSlackワークスペースを越えて切り替える

## 利用者価値

Brainbaseを複数事業体で利用する本人として、最初にログインしたSlackワークスペースに縛られず、自分に明示的に付与された組織だけを同じ管理画面で切り替えたい。これにより、雲孫とTechKnightのようにSlackワークスペースが異なる組織でも、組織ごとの別ドメインや再ログインを必要としない。

## 受け入れ条件

- `PSOS-AC-001`: 組織一覧は署名済みアクセストークンの`personId`に紐づくactiveな`auth_grants`だけを返す。
- `PSOS-AC-002`: 組織切替は同じ`personId`の対象組織grantを検証し、対象grantのSlack identity・workspace・role・project scopeで新しいaccess/refresh tokenを発行する。
- `PSOS-AC-003`: 対象組織のactive grantがない場合、または同じ人物・組織のactive grant間でrole・project scope・clearanceが競合する場合は切替を拒否する。同じ実効権限を複数のSlack identityへ付与したgrantは1組織として扱う。
- `PSOS-AC-004`: access/refresh token、URL、Cookieに他組織への権限をまとめて持たせず、切替後のセッションは選択した1組織だけに束縛する。
- `PSOS-AC-005`: Slack OAuthによる最初の本人確認と、組織ごとの`auth_grants`による認可を分離し、ログイン時の正確なworkspace照合は変更しない。

## 対象外

- 未登録の人物や組織への自動権限付与
- Slack workspace connectionやOAuth credentialの統合
- テナントごとの専用ドメイン

## 検証

- `tests/unit/auth-service-grants.test.js`
- `tests/server/routes/auth-slack-route.test.js`
