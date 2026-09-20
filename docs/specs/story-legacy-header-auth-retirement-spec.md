# 共有認証の非本番自己申告header退役 Spec

Story: `docs/management/stories/active/story-legacy-header-auth-retirement.md`

## 対象

- `server/middleware/auth.js`
- `server/lib/validation.js`
- `tests/server/middleware/auth.test.js`
- `scripts/setup.sh`

## 正規の認証契約

`resolveAuthContext`は、OPTIONSのCORS bypass、internal API key、Bearer/cookie tokenの順に既存契約を維持する。Bearer tokenが`bbsvc_`で始まる場合はservice-token verifierを使い、それ以外は既存のJWT verifierを使う。検証済みclaimからSlack/Google provider identityを構成し、headerの自己申告値で上書きしない。

## 退役する経路

- `x-brainbase-role`、`x-role`、`x-brainbase-projects`、`x-projects`、`x-brainbase-clearance`、`x-clearance`から`access`を構成する共有middleware分岐を削除する。
- `ALLOW_INSECURE_SSOT_HEADERS`、`BRAINBASE_TEST_MODE`、`NODE_ENV=test`を認証許可へ変換する専用helperを削除する。
- setupが`.env`やmacOS launchd plistへ`ALLOW_INSECURE_SSOT_HEADERS`を出力しないようにする。

`BRAINBASE_TEST_MODE`はSNS、E2E、runtime isolationなど別用途で使われるため、package scriptや別サービスのtest gateから削除しない。

## 受け入れテスト

1. `BRAINBASE_TEST_MODE=true`でheaderだけを送った`requireAuth`は401を返す。Bearer tokenは送らず、自己申告role・project・clearanceが認証に昇格しないことを確認する。
2. 検証済みBearerにspoofing headerを添えても、access role/project/person identityは検証済みclaimのままである。
3. Slack provider JWT、Google provider JWT、session cookie、internal API key、`bbsvc_` service token、OPTIONS bypassの既存テストが通る。
4. 明示的に`allowInsecureHeaders: false`を渡す既存routeと、下流の`authSource === 'insecure-header'`拒否側テストは変更せず通る。

## 変更しない境界

- `BRAINBASE_TEST_MODE`全体、DB、production設定、本番操作、個人設定。
- `knowledge-retrieve-service-auth.js`の未信頼header拒否。
- mesh、Info SSOT、Companion Task、Slack installation control-planeなどの明示拒否・防御コード。
- `run-receipts`、`external-runner`、`companion`の下流dead-branch整理と、関連文書の更新。

## 影響確認

変更前のGraphify軽量参照は、対象4ファイルに対して`status=partial`、`freshness=unknown`、`impact=unknown`、`scripts/setup.sh`は`unmatched`だった。したがって、Graphify結果は候補関係の確認に限定し、`rg`による呼び出し調査と対象fixtureで補完する。変更後は同じ対象に一度だけ`--refresh-graph`を実行する。

## ロールバック

コードとテスト・setupの変更を単一commitでrevertできる。保存データ、secret、外部環境は変更しない。
