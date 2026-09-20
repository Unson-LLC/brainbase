# レガシー退役後の互換境界の追加検証

## 利用者成果

残存コードを実利用と混同せず、削除可能な互換処理と保護する正規経路を根拠付きで分離する。

## 棚卸し時の追加作業

- Canonical Taskの未指定backendは既存契約どおりNocoDBを保持する。全対象環境の明示cutover/readbackと既存Story・Spec・authority契約の更新を別変更で確認してから既定値を移す。本番の明示的PostgreSQL設定と、未設定環境の移行完了を混同しない。
- Wikiの保存済みデータを読む2本のスクリプトについて、`--dry-run`時の無書込みと読取失敗時の挙動をfixtureで固定する。非dry-runの接続前拒否は既に検証対象。
- サーバーの非本番`insecure-header`互換とInfo SSOT controller直接fallbackについて、既存テストを正規認証fixtureへ移せるか確認する。本番では当該header認証は無効で、Slackと`bbsvc_`サービス認証は別経路。共有認証を一括削除しない。
- `vibepro-graph-ssot-check.mjs`、`ontology-release-publish.js`、`generate-memory-preamble.mjs`はBearerを要求する内部クライアント。スクリプト全体ではなく、冗長な`x-brainbase-*`ヘッダーの除去を個別に検証する。
- CLIの認証保存ではDevice Flowの応答に`expires_at`がなければ30日後を保存する一方、取得済みJWTはより早く失効し得る。期限判定・refresh token保持を別の認証修正として検証する。JWT payloadのデコードは署名検証ではなく、401の正式な原因判定はサーバー側の検証結果と区別する。
- `docs/guides/member-onboarding.md`と`.claude/skills/add-mcp/SKILL.md`に残る旧NocoDB MCPの手動追加案内を、退役後の契約へ更新する。ユーザー別設定や外部コピーは別途読み取り確認し、共有MCPや保存データを一括削除しない。
- `tests/e2e/story-canonical-task-postgres-ssot-contract.spec.ts`の模擬DB fixtureを現行のschema preflightに合わせる。変更前`a28392375c`とNocoDB退役変更後で同じ11件中4件が失敗し、`project_codes`と索引問い合わせの模擬応答不足により本来の競合・復旧分岐へ到達しない。実DB障害や今回の回帰と混同せず、別Specでfixture修正後に再検証する。

## 受入条件

各変更は独立した最小Specと対象テストを持ち、Slack Device Flow、保存済みの有効な認証、他テナントのGoogle認証、共有Personal KG・learning・サービス認証を維持する。旧Wiki/SQLite/JSONデータの削除や、秘密情報の変更を含めない。

## 追加修正の検証結果

以下はソースと対象テストの結果であり、全環境への反映完了を示すものではない。

| 項目 | ソースでの対応 | 検証 |
| --- | --- | --- |
| Wiki調査スクリプト2本 | dry-run専用runner、書込経路除去、両スクリプトのquery失敗の伝播 | fixture 7件と既存退役4件が通過。実DB・保存データは未調査 |
| 内部クライアント3本 | Bearerを維持し旧ヘッダーを除去 | 対象38件通過 |
| Info SSOT直接fallback | controllerは検証済み`req.access`を必須とする | 統合レビューの実測は6件通過、DB設定が必要な13件はskip。共有middlewareの退役は別PR #1703で実施 |
| CLI認証期限 | 30日固定を除去し発行期限を上限にする。refresh tokenを保持 | 対象32件通過。自動refreshの実装や本番再認証の成功は意味しない |
| 旧MCP案内2箇所 | 退役済みNocoDB MCPの追加案内を除去 | NocoDB MCP退役テスト11件通過。外部コピーは未確認 |
| PostgreSQL契約fixture | 現行必須列・索引queryへ追随 | 変更前4件失敗、変更後11件通過。実DB移行とは別 |

統合時の受入条件は`docs/specs/story-legacy-compatibility-followups-closeout-spec.md`、Info SSOTは`docs/specs/info-ssot-auth-context-spec.md`、CLIは`docs/specs/story-legacy-cli-auth-fail-closed.md`、PostgreSQL fixtureは`docs/specs/story-canonical-task-postgres-contract-fixtures-spec.md`を参照する。

PR #1703で共有middlewareの非本番header互換を退役した。2026-09-20の本番確認では、merge SHA `29019ecad28a5fdcb21fe42bfefdfee8d38d9648`の配備、同一SHAのapply receipt、readiness、正規利用者認証によるGraph・Canonical Task GETを確認した。header-onlyのGraph要求は401だった。この結果は将来のHEADや別環境には適用しない。

下流の旧header許可分岐と`allowInsecureHeaders`引数は追加整理した。認証対象9ファイル104件、追加呼出し側8ファイル90件、型チェックが通過した。常時exclude対象の`project-provisioning-full-flow.test.js`は未実行である。統合・配備・稼働readbackはソースの検証と区別する。

引き続き未完了なのは、未指定backendの全環境移行、追加整理の統合・配備、外部設定の退役と稼働readbackである。

Macの限定監査では、停止済み`com.brainbase.mcp-nocodb`のplistをLaunchAgents外へ退避し、UI plistの`ALLOW_INSECURE_SSOT_HEADERS`を削除して構文検証した。古い作業checkoutの`.mcp.json`からもNocoDB entryだけを除去し、他の設定が不変であることを確認した。MCP plistの`BRAINBASE_WIKI_API_URL`はGraph URLと同値だったため除去した。各設定は事前に復元用コピーを保持し、稼働プロセスへの再読込は別確認とする。保存データ・利用履歴・他タスクの変更は削除していない。トンネル側の`BRAINBASE_WIKI_API_URL`は異なる接続先であり、learning APIにも利用されるため、名前だけで未使用とは扱わず維持した。

`migrate-graphdb-to-wiki.js`側のDB query拒否も専用fixtureで固定した。偽poolだけを使い、実DB接続なしで失敗が伝播することを確認した。

Info SSOTの既存エラー文`Slack OAuth token required`は、認証方式に依存しない`Authenticated access context required`へ変更し、401分類をテストした。認証判定自体は変更していない。

## 未確認

外部コピー、別mount、全ホストの利用状況は未確認。静的参照があることだけを実利用の証拠とせず、参照が見つからないことだけを全範囲の不在証明としない。

## 未指定backendの廃止前に確認する範囲

コード上で明示`postgres`を確認できるのはGrowin APIの`infra/gcp/growin/main.tf`。これだけで実機反映や全環境の移行完了とは判定しない。

- `scripts/setup.sh`が生成するローカルruntime設定。
- `.env.example`、`infra/brainbase-organization/production.env.example`の配布設定と実際の注入元。
- `start.js`などを手動起動する環境の`.env`・`BRAINBASE_ENV_PATH`。
- 各対象環境の明示backend、移行データ整合性、同一HEADでのreadinessと実APIのreadback。

2026-09-20の実機読み取りでは、Macの稼働runtimeは本番と同じ`29019ec`でもbackend未指定である。Mac上のDBは`canonical_tasks`273件・readiness closed、本番LightsailのDBは951件・readiness readyだった。これらは別DBであり、件数差だけでは未移行件数を算出できない。ローカルDBを本番正本とみなしたり、環境変数だけを変更してwriterを有効化したりしない。ローカル経路の用途とデータ照合・切替証拠は未完了。

以上を確認してから、既存Story・Spec・authority契約と未指定backendテストを一緒に更新する。デフォルト値だけの変更、認証失敗を未利用と解釈すること、古いHEADのreadiness流用は行わない。
