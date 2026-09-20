# 外部ログインの正規本人ID優先 Spec

Story: `docs/user_stories/active/story-canonical-person-auth-principal.md`

## 問題

JWTが外部providerのsubjectを `sub`、Brainbaseの正規本人IDを `personId` として持つ場合、共有認証middlewareが `sub` を先に採用していた。組織接続APIは `per_*` の本人IDを要求するため、認証済み管理者でも403になった。

## 契約

- user JWTの `access.personId` は `decoded.personId ?? decoded.sub ?? null` とする。
- service tokenは既存契約を維持する。
- provider subjectは `providerSubject` と、Slackの場合の `slackUserId` に保持する。
- 旧sessionで `personId` がcanonical形式でない場合、共有認証middlewareは検証済みのprovider identityを使って既存grantを読み取り専用で照合し、`per_*` を一意に得た場合だけ `access.personId` を正規化する。
- 旧Slack sessionがprovider claimを持たず `sub=U_*` だけを持つ場合は、その署名済みsubjectをSlack identityとして照合する。解決不能時は元claimを残し、canonical person必須のconsumerでfail closedする。
- route固有のSlack照合は追加しない。GitHubなど別providerの管理をSlack接続へ結合しないためである。

## 検証

1. `sub=U_*`, `personId=per_*` の検証済みJWTで `access.personId` が `per_*` になる。
2. `personId` がない旧JWTではcanonicalな `sub` を維持する。
3. 既存のprovider identity、tenant解決、組織接続routeテストが通る。
4. `sub=U_*` の旧Slack sessionは既存grantの `per_*` へ正規化され、未解決時に架空のpersonを生成しない。

## ロールバック

認証middleware、回帰テスト、Story、Specの単一commitをrevertする。DB、secret、外部provider設定は変更しない。
