# 外部ログインの正規本人ID優先 Spec

Story: `docs/user_stories/active/story-canonical-person-auth-principal.md`

## 問題

JWTが外部providerのsubjectを `sub`、Brainbaseの正規本人IDを `personId` として持つ場合、共有認証middlewareが `sub` を先に採用していた。組織接続APIは `per_*` の本人IDを要求するため、認証済み管理者でも403になった。

## 契約

- user JWTの `access.personId` は `decoded.personId ?? decoded.sub ?? null` とする。
- service tokenは既存契約を維持する。
- provider subjectは `providerSubject` と、Slackの場合の `slackUserId` に保持する。
- route固有のSlack照合は追加しない。GitHubなど別providerの管理をSlack接続へ結合しないためである。

## 検証

1. `sub=U_*`, `personId=per_*` の検証済みJWTで `access.personId` が `per_*` になる。
2. `personId` がない旧JWTではcanonicalな `sub` を維持する。
3. 既存のprovider identity、tenant解決、組織接続routeテストが通る。

## ロールバック

認証middleware、回帰テスト、Story、Specの単一commitをrevertする。DB、secret、外部provider設定は変更しない。

