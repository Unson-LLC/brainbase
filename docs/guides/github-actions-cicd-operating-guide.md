# GitHub Actions運用ガイド

## CIの責務

変更対象に応じて、必要な検証だけを実行する。

| 変更・操作 | 実行する検証 | 副作用 |
| --- | --- | --- |
| パッケージ関連のPull Request | Node 22の`npm test`（Vitestの完全収集）とbuild、Node 20の代表統合スイート | deployなし |
| ドキュメント関連のPull Request | `docs:check`、公開契約テスト、VitePress build、built HTML smoke | deployなし |
| `develop`への公開サイト入力のpush | 上記ドキュメント検証、Cloudflare Pages deploy、`docs:verify-public`による公開後readback | 公開サイトのみ |
| npm公開 | immutable commitのrelease validation、artifact/proofの受け渡し、provenanceなしpublish（self-hosted runnerではnpmのprovenanceが使えないため。publishジョブだけがOIDCガード用に`id-token: write`を持ち、`NPM_CONFIG_PROVENANCE=false`を明示）、GitHub Release確認 | npm公開権限はrelease workflowだけが使用 |
| public-message promotion | 候補の契約検証とドキュメント検証を済ませたreview PRの作成 | 自動merge・自動deployなし |

`docs-cloudflare-pages.yml`のpush deploy入力は、`docs/manual/**`、`docs/.vitepress/**`、`docs/publication/public-message.json`、`docs/publication/organization-teaser.json`、`package.json`、`package-lock.json`、同workflow自身に限定する。CIガイドやStoryなど内部文書だけの変更ではdeployしない。

`.vibepro/**`だけのPull Requestは、Story metadataやローカル証跡としてpackage/docs CIの対象外とする。`.vibepro`の設定がCI実行、package、docs、publicationの生成へ作用する変更を追加する場合は、この免除を使わず対象workflowの入力へ追加し、安全側で検証する。

`npm ci`はlifecycleの`prepare`でbuildを起動するため、各workflowは`npm ci --ignore-scripts`を使い、必要なbuildを明示的に一度だけ実行する。docs workflowはpackage build/testを担当せず、ドキュメント契約に集中する。

失敗またはキャンセル時は、各workflowの`GITHUB_STEP_SUMMARY`に保護していた要件、再現コマンド、期待結果、未確認の状態を記録する。package CIはpackage検証、docs CIは公開readback、npm publishはartifact・registry・Releaseのreadback、promotionはreview PRの状態を確認対象とする。公開やnpm publishの再実行は、この未確認状態を確認してから判断する。

## 手動実行

| ジョブ名 | 目的 | ワークフロー | ランナー |
| --- | --- | --- | --- |
| Cloudflare Worker secret同期 | 対象account IDを固定確認し、`brainbase-tenant-runtime`の`BRAINBASE_SERVICE_JWT`を1件だけ更新する | `.github/workflows/docs-cloudflare-pages.yml` | `[self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]` |

## ランナー

CIはGitHub-hosted runnerを使わない。`ubuntu-latest`を含むGitHub-hostedラベルは置かない。各workflowのjobは、組織のself-hosted runnerである次のラベルだけで実行する。

```yaml
runs-on: [self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]
```

例外は`npm-publish.yml`のpublish jobだけで、`runs-on: ubuntu-latest`で実行する。npmはprovenance（sigstoreの来歴署名）をGitHub-hosted runnerからしか受け付けず、self-hosted runnerでは`npm publish --provenance`が`E422 Unsupported GitHub Actions runner environment: "self-hosted"`で拒否される（2026-10-15、0.41.5のrun 38713407935）。provenanceを外さずに公開するため、佐藤さんの判断（2026-10-15）でpublish jobだけを戻した。validate jobを含むほかのjobはself-hosted runnerのままである。publish jobはpull requestのheadを読まず、developとvalidate jobが作ったartifactだけを使う。

EVO-X2は1台の機械に複数のrunnerを載せている。Vitestは既定で機械のコア数に合わせて並列数を決めるため、複数のjobが同時に動くと機械が飽和し、変更と無関係なテストが5秒の上限で落ちる（2026-10-15、PR #786で3回続けて発生）。`test.yml`のテストは`--maxWorkers=4`で並列数を固定する。手元で全テストを3本同時に走らせると、既定では各9〜10件が時間切れになり、4に固定すると全件合格した。

このリポジトリは公開されている。forkのpull requestをself-hosted runnerで実行すると、未信頼のworkflowとコードが組織のマシンに載る。`pull_request`で動くjobは、headがこのリポジトリ自身のときだけ実行する。

```yaml
if: ${{ github.event.pull_request.head.repo.full_name == github.repository }}
```

`docs-cloudflare-pages.yml`は同一jobで`push`と`workflow_dispatch`も扱う。そのjobの条件は次のとおり。

```yaml
if: ${{ github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository }}
```

`author_association`が`MEMBER`または`OWNER`であることだけを許可条件にしない。その条件を`head`リポジトリ一致とORで結ぶと、メンバーがforkから開いたpull requestもrunnerへ入る。ANDだけにすると、`author_association`が`NONE`の同一リポジトリ自動化（public-message promotionが開くreview PRなど）が止まる。forkを止める条件は、headリポジトリが`github.repository`と一致することに固定する。

`pull_request_target`でpull requestのheadをcheckoutしない。`npm-publish.yml`の`pull_request_target`は、developへmerge済みのときと`workflow_dispatch`のときだけ動く。checkoutは`develop`と、merge commitまたは`origin/develop`の祖先である。`NODE_AUTH_TOKEN`はpublish jobだけが読む。validate jobは公開用secretを持たない。

`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`BRAINBASE_SERVICE_JWT`はjobのenvに置かない。対象確認、Worker secret同期、deploy前確認の各stepのenvだけが、そのstepが使うsecretを読む。Cloudflare Pages deployのwrangler-actionは`with`で`secrets.*`を直接参照する。

すべての`actions/checkout`は`persist-credentials: false`である。`public-message-promotion.yml`のreview branch pushは、そのコマンドだけで`GH_TOKEN`を`http.extraheader`に渡す。checkoutには資格情報を残さない。

各`uses`は、公式リポジトリのタグと一致する40文字のcommit SHAに固定し、行末にそのタグのコメントを付ける。

`pull_request`のworkflow定義は、対象PRの内容が使われる。forkが`if`を消したworkflowを送った場合、GitHubが外部コラボレーターのworkflow承認を維持していることが残りの境界になる。承認後も、このリポジトリの既定workflowはfork headをself-hostedで実行しない。

## 必要なSecrets

- `CLOUDFLARE_ACCOUNT_ID`: 対象CloudflareアカウントID
- `CLOUDFLARE_API_TOKEN`: Worker secretを更新できる限定API token
- `BRAINBASE_SERVICE_JWT`: `brainbase-tenant-runtime`へ同期するservice token

`workflow_dispatch`の`expected_account_id`が`CLOUDFLARE_ACCOUNT_ID`と一致しない場合は、書き込み前に失敗する。
