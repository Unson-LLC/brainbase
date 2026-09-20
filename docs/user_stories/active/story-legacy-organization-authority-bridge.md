# Story: 旧組織ログインを正規テナントへ橋渡しする

## Outcome

既存のUNSON Slackログイン利用者として、現在の認証grantを失わずに正規テナントのプロジェクト接続を操作できる。

## Acceptance criteria

- `unson` が active な Unson Business tenant へ一意に解決される。
- 既存auth grantのproject codesとclearanceを変更しない。
- Graph正本に存在し、同じorganizationに属するBAAO projectだけをtenant projectionへ登録する。
- tenant organization、project、membershipを同一transactionで冪等に作成する。
- 同じtenantに既存の旧組織ID別名行がある場合は再利用し、Graph対応を二重登録しない。
- dry-runは同じ検証とreadbackを行い、永続化しない。
- apply後は別connectionでもtenant contextをtransaction内に設定し、RLSを迂回せずresolver、organization、project、membershipをreadbackできる。
