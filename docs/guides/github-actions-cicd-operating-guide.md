# GitHub Actions運用ガイド

## CIの責務

変更対象に応じて、必要な検証だけを実行する。

| 変更・操作 | 実行する検証 | 副作用 |
| --- | --- | --- |
| パッケージ関連のPull Request（`develop`または`main`向け） | Node 22の`npm test -- --maxWorkers=4`（Vitestの完全収集）とbuild、Node 20の代表統合スイート | deployなし |
| パッケージ関連のPull Requestの正式release検証 | 組織のself-hosted runnerのNode 22で、immutableなPR headと実在するPR branch remoteを対象に`npm run release:validate`（build、完全テスト、production依存監査、pack、consumer smoke）を実行 | npm公開・deployなし。proofとtarballを短期artifactとして保存 |
| ドキュメント関連のPull Request（`develop`または`main`向け） | `docs:check`、公開契約テスト、VitePress build、built HTML smoke。`package.json`のversionは`docs/manual/guide/status.md`の最初のReleasedまたはCandidate見出し、および`docs/manual/reference/version-history.md`の対応見出しと一致していること | deployなし |
| `develop`への公開サイト入力のpush | 上記ドキュメント検証のみ（deployなし） | なし |
| `main`への公開サイト入力のpush | 上記ドキュメント検証、Cloudflare Pagesの`production_branch`へのdeploy、deploymentが`production`であることの確認、`docs:verify-public`による`https://brainbase.pages.dev`の公開後readback（18回、5秒間隔） | 公開サイトのみ |
| npm公開 | `main`へのpushまたは手動dispatch。immutable commitのrelease validation、registry既存versionのskip、artifact/proofの受け渡し、GitHub-hosted runnerでのprovenance付きpublish（publishジョブだけが`id-token: write`を持つ）、GitHub Release確認 | npm公開権限はrelease workflowだけが使用 |
| public-message promotion | 候補の契約検証とドキュメント検証を済ませたreview PRの作成 | 自動merge・自動deployなし |

`docs-cloudflare-pages.yml`のpush deploy入力は、`docs/manual/**`、`docs/.vitepress/**`、`docs/publication/public-message.json`、`docs/publication/organization-teaser.json`、`package.json`、`package-lock.json`、同workflow自身に限定する。CIガイドやStoryなど内部文書だけの変更ではdeployしない。

`.vibepro/**`だけのPull Requestは、Story metadataやローカル証跡としてpackage/docs CIの対象外とする。`.vibepro`の設定がCI実行、package、docs、publicationの生成へ作用する変更を追加する場合は、この免除を使わず対象workflowの入力へ追加し、安全側で検証する。

`npm ci`はlifecycleの`prepare`でbuildを起動するため、各workflowは`npm ci --ignore-scripts`を使い、必要なbuildを明示的に一度だけ実行する。docs workflowはpackage build/testを担当せず、ドキュメント契約に集中する。

失敗またはキャンセル時は、各workflowの`GITHUB_STEP_SUMMARY`に保護していた要件、再現コマンド、期待結果、未確認の状態を記録する。package CIはpackage検証、docs CIは公開readback、npm publishはartifact・registry・Releaseのreadback、promotionはreview PRの状態を確認対象とする。公開やnpm publishの再実行は、この未確認状態を確認してから判断する。

## イベントトリガー実行

| ジョブ名 | 目的 | ワークフロー | ランナー |
| --- | --- | --- | --- |
| PR headの正式release検証（`formal-release-validate-linux`） | pull requestのimmutableなheadでbuild、完全テスト、production依存監査、pack、consumer smokeを実行し、proofとtarballを短期保存する | `.github/workflows/test.yml`（`pull_request`） | `[self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]` |

## 手動実行

| ジョブ名 | 目的 | ワークフロー | ランナー |
| --- | --- | --- | --- |
| Cloudflare Worker secret同期 | 対象account IDを固定確認し、`brainbase-tenant-runtime`の`BRAINBASE_SERVICE_JWT`を1件だけ更新する | `.github/workflows/docs-cloudflare-pages.yml` | `[self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]` |

## ランナー

CIの通常jobは、組織のself-hosted runnerである次のラベルだけで実行する。

```yaml
runs-on: [self-hosted, Linux, X64, wsl-linux, nucbox-evo-x2]
```

例外は、npm provenance（sigstoreの来歴署名）を付けて公開する`npm-publish.yml`のpublish jobだけで、`runs-on: ubuntu-latest`で実行する。npmはprovenanceをGitHub-hosted runnerからしか受け付けず、self-hosted runnerでは`npm publish --provenance`が`E422 Unsupported GitHub Actions runner environment: "self-hosted"`で拒否される（2026-10-15、0.41.5のrun 38713407935）。`test.yml`の`formal-release-validate-linux`は同じself-hostedラベルで実行する。このjobは`contents: read`だけを持ち、Secrets・OIDC・npm公開・deploy権限を持たない。publish jobはpull requestのheadを読まず、`main`とvalidate jobが作ったartifactだけを使う。

EVO-X2は1台の機械に複数のrunnerを載せている。Vitestは既定で機械のコア数に合わせて並列数を決めるため、複数のjobが同時に動くと機械が飽和し、変更と無関係なテストが5秒の上限で落ちる（2026-10-15、PR #786で3回続けて発生）。`test.yml`のテストは`--maxWorkers=4`で並列数を固定する。手元で全テストを3本同時に走らせると、既定では各9〜10件が時間切れになり、4に固定すると全件合格した。

self-hosted runnerのjobは`actions/setup-node`の`cache: npm`を使わない。EVO-X2の15本のrunnerは同じユーザーの`~/.npm`を共有するため、Actions cacheへ保存されるのは全リポジトリが取得したpackageの総量になる。GitHub-hosted runnerのときは74MBだったcacheが、移行後は422MB・660MB・902MB・1087MBと増え、復元に約10分かかって認証が切れ、後処理の保存でjobが20分の上限を超えた（2026-10-15、PR #791で2回）。`~/.npm`はEVO-X2に残るので、Actions cacheを経由しなくても再取得は少ない。`package.json`に`packageManager`を置くとsetup-nodeが自動でcacheするため、置かない。

このリポジトリは公開されている。forkのpull requestをself-hosted runnerで実行すると、未信頼のworkflowとコードが組織のマシンに載る。`pull_request`で動くjobは、headがこのリポジトリ自身のときだけ実行する。

```yaml
if: ${{ github.event.pull_request.head.repo.full_name == github.repository }}
```

`docs-cloudflare-pages.yml`は同一jobで`push`と`workflow_dispatch`も扱う。そのjobの条件は次のとおり。

```yaml
if: ${{ github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository }}
```

`author_association`が`MEMBER`または`OWNER`であることだけを許可条件にしない。その条件を`head`リポジトリ一致とORで結ぶと、メンバーがforkから開いたpull requestもrunnerへ入る。ANDだけにすると、`author_association`が`NONE`の同一リポジトリ自動化（public-message promotionが開くreview PRなど）が止まる。forkを止める条件は、headリポジトリが`github.repository`と一致することに固定する。

`pull_request_target`でpull requestのheadをcheckoutしない。`npm-publish.yml`は、`main`への`push`と`workflow_dispatch`のときだけ動く。npmは`pull_request_target`から来たTrusted Publishingのトークンを拒否するので、このイベントでは起動しない。checkoutは`main`と、pushされたcommitまたは`origin/main`の祖先である。version bumpが無い場合、またはnpm registryに同じ`gitHead`のversionが既にある場合は公開をskipする（`main`を既公開commitへ戻したときの再実行も失敗しない）。npmへの公開はpublish jobのnpm Trusted Publishing（OIDC）だけで認証し、npm tokenのsecretを使わない。validate jobは`id-token: write`も公開用secretも持たない。integrate branchは`develop`、production branchは`main`であり、npm公開と公開サイトdeployは`main`への昇格後だけ行う。

Gitのproduction branchが`main`であることと、Cloudflare Pages projectの`production_branch`は別である。`wrangler pages deploy --branch=main`は、projectの`production_branch`が`main`でないときpreviewになる。成功ログの`Deployment alias URL`（例: `https://main.brainbase.pages.dev`）はpreviewであり、本番ホスト`https://brainbase.pages.dev`は前回のproduction deploymentのままになる。npm publishの完了はpreviewをproductionへ昇格しない。docs workflowはdeploy前にAPIで`production_branch`を読み、そのbranchへ出す。確認するのは、その実行のwranglerが返したdeployment idだけである。同じcommitの古いpreviewでは失敗しない。そのidの`environment`が`production`でなければreadbackへ進まず失敗する。readbackは本番ホストに対する18回×5秒のまま、このproduction deployの直後に行う。`develop`へのマージはdeployしない。`main`へのマージは、pushのpath filterに当たる変更があるとき本番deployになる。`workflow_dispatch`の`deploy=true`は`refs/heads/main`だけを許可する。それ以外のrefは理由を出して失敗し、deployしない。許可された手動deployでは、checkout、`--commit-hash`、readbackが同じcommit SHAを指す。

versionを上げるPull Requestは、merge前に次を同じcommitへ入れる。`docs/manual/guide/status.md`では、最初の`## Candidate — v<version>（npm公開前）`見出しを既存のCandidate見出しより前に追加する（すでにそのversionが最初の`## Released — v<version>`である場合を除く）。`docs/manual/reference/version-history.md`には`## <version> candidate — npm公開前`を追加する。判定に使うのは各ファイルの最初のReleased見出しと最初のCandidate見出しだけである。不一致は`npm run docs:check`とpackage testが、追加すべき見出しを含むメッセージで失敗する。この検査は`main`向けのPull Requestでもdocs workflowが実行する。release CLIはpackage.jsonを自動変更しない。見出しの本文は人が書く。

`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`BRAINBASE_SERVICE_JWT`はjobのenvに置かない。対象確認、Worker secret同期、deploy前確認、production branchの解決、production deploymentの確認の各stepのenvだけが、そのstepが使うsecretを読む。Cloudflare Pages deployのwrangler-actionは`with`で`secrets.*`を直接参照する。

すべての`actions/checkout`は`persist-credentials: false`である。`public-message-promotion.yml`のreview branch pushは、そのコマンドだけで`GH_TOKEN`を`http.extraheader`に渡す。checkoutには資格情報を残さない。

各`uses`は、公式リポジトリのタグと一致する40文字のcommit SHAに固定し、行末にそのタグのコメントを付ける。

`pull_request`のworkflow定義は、対象PRの内容が使われる。forkが`if`を消したworkflowを送った場合、GitHubが外部コラボレーターのworkflow承認を維持していることが残りの境界になる。承認後も、このリポジトリの既定workflowはfork headをself-hostedで実行しない。

## 必要なSecrets

- `CLOUDFLARE_ACCOUNT_ID`: 対象CloudflareアカウントID
- `CLOUDFLARE_API_TOKEN`: Worker secretを更新できる限定API token
- `BRAINBASE_SERVICE_JWT`: `brainbase-tenant-runtime`へ同期するservice token

`workflow_dispatch`の`expected_account_id`が`CLOUDFLARE_ACCOUNT_ID`と一致しない場合は、書き込み前に失敗する。
