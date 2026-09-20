# Story: 外部ログインから正規の本人権限で組織アプリを管理する

## Outcome

組織管理者が Slack などの外部ログインを使っていても、外部サービスの subject ではなく Brainbase の正規 person ID で本人確認され、Mana の組織アプリを接続・確認できる。

## Acceptance criteria

- 検証済みJWTに `personId` と `sub` の両方がある場合、`personId` を正規の本人IDとして使う。
- `sub` が Slack user ID などのprovider subjectでも、正規person IDを上書きしない。
- `personId` を持たない旧JWTは、従来どおりcanonicalな `sub` を本人IDとして扱う。
- `personId` を持たず `sub=U_*` の旧Slack sessionは、検証済みSlack identityから既存のcanonical personを読み取り専用で解決する。
- 旧Slack sessionのworkspace claimが古い場合でも、署名済みのorganization内に有効なgrantがあるときだけcanonical personを復旧する。organization claimがない場合や別組織のgrantでは復旧しない。
- 組織切替後のaccess token、refresh token、監査ログには、grantに残った古いworkspaceではなくorganizationのcanonical workspaceを記録する。
- 旧refresh tokenも署名済みorganization内のgrantで復旧し、次のtokenからcanonical workspaceへ更新する。
- 外部identityをcanonical personへ一意に解決できない場合は推測せず、canonical person必須のAPIで拒否する。
- GitHub接続管理をSlack installationの有無へ依存させない。
- 組織接続APIの管理者・tenant・person境界を緩めない。
