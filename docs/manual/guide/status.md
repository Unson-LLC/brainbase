# 現在の状態

このページは、Brainbaseの思想、公開release、`develop`、将来計画を混同しないための境界表です。

配信中の正確なcommitは、各ページ下部の`Build <SHA>`で確認できます。

## Released — v0.19.0

目的・保存時点の現状・哲学・世界モデルを同じ範囲で読む共通UIと読み取りAPIを公開しました。共通UIはホストから読取portを受け取り、組織の認証と許可範囲は組織版が担当します。組織版への取込みと本番画面の確認は別の段階です。

公開確認済みの配布証跡は次のとおりです。

- npm package [`@unson/brainbase-mcp@0.19.0`](https://www.npmjs.com/package/@unson/brainbase-mcp/v/0.19.0)
- npmの`latest`は`0.19.0`を指し、registryの`gitHead`は`7cd7be975882fd1cbc797b7992b27a221f9fc02f`、integrityは`sha512-2xFtzRvppxqVFzVhdySNoGqelZsJItQIvxljM7IBWE2pgFVIE1etY0K8Vh4GwFz3W+tD/hNDxaANxBZ2jVDyYA==`
- GitHub Release [`v0.19.0`](https://github.com/Unson-LLC/brainbase/releases/tag/v0.19.0)は同じcommitを指し、正式版としてLatestに掲載
- 公開とlatestの照合を完了したworkflowの検証済みrun [`37415232781` attempt 2](https://github.com/Unson-LLC/brainbase/actions/runs/37415232781/attempts/2)
- 空の設定・キャッシュを使う独立したnpm consumerで、正確なversion・integrity、新しい公開口、CLIの起動とPersonal Onboardingを確認

公開用の一時タグ`release-7cd7be975882`の削除は、registry権限エラーで未完了です。正式版の配布、`latest`、GitHub Releaseの照合は完了しています。

## Released — v0.18.1

0.18.1で、OSSのプロジェクトワークスペースの余白、文字の強弱、境界線を整理し、組織版のシンプルなデザインに合わせました。package stylesheetの公開口は既存のままです。

公開確認済みの配布証跡は次のとおりです。

- npm package [`@unson/brainbase-mcp@0.18.1`](https://www.npmjs.com/package/@unson/brainbase-mcp/v/0.18.1)
- 公開時点のnpmの`latest`は`0.18.1`を指し、registryの`gitHead`は`9037a15719140c0e5c4e28f29975f98aa970c557`、integrityは`sha512-K0KYduvNDb/RIDiwocm1PI0Wk8C095KZdv+FBlsbyYZPRRiw0XgYMTXwfe4yrJzsXghL4u4dfiDBAPmv6pO4oA==`
- GitHub Release [`v0.18.1`](https://github.com/Unson-LLC/brainbase/releases/tag/v0.18.1)
- 公開とlatestの照合を完了したworkflowの検証済みrun [`37413609018`](https://github.com/Unson-LLC/brainbase/actions/runs/37413609018)

## Released — v0.18.0

0.18.0までのnpm packageとGitHub Releaseで公開済みのOSS範囲です。

公開確認済みの配布証跡は次のとおりです。

- npm package [`@unson/brainbase-mcp@0.18.0`](https://www.npmjs.com/package/@unson/brainbase-mcp/v/0.18.0)
- 公開時点のnpmの`latest`は`0.18.0`を指し、registryの`gitHead`は`0913d58555fe29ce69b49bb85bf6e21b6c9ed6d9`、integrityは`sha512-/EKrE3r61tJgo5s85GMYEDzqh7HVjwgZo9T8DtbuM0vLRK2V7kBcfs7sj1CgFmCT0DqHi02vR3ZsTpJgSZmIuA==`
- GitHub Release [`v0.18.0`](https://github.com/Unson-LLC/brainbase/releases/tag/v0.18.0)
- 公開workflowの検証済みrun [`37409099606` attempt 2](https://github.com/Unson-LLC/brainbase/actions/runs/37409099606/attempts/2)

- ローカル優先のPersonal Onboarding Kit
- MCPによる`get_context`、`search`、`resolve_entity`などの文脈参照
- Graph v2とRelation Registry
- Ontology 2.0.0と履歴versionの解釈
- Graphの候補発見・関係探索・根拠取得と、任意の埋め込み接続
- OSS Graphを設定した組織サービスへ移行・検索するための明示的な接続境界
- Evidence Receipt
- Judgment systemとしてのCore Philosophy
- Judgment DAGのarchitectureとroadmap
- typed DAG contractとpreflight validation
- ローカルの決定論的Judgment DAG runner
- content-addressedなrun artifactの保存・検証付き再読込
- 過去runのreplay、outcome attachment、version間evaluationのprimitive
- 判断が生んだ変化を機械可読に表すvalue-proof contractとrenderer
- npm consumer smokeと公開契約digest
- OSSとOrganizationで共用するoutcome knowledge UI（Mana委任UIとicon assetsは0.9.0で共通UIから外し、組織版の画面にした）
- Organization版が共通UIを再実装せず、OSS packageから利用するための公開subpath

- Company OSのObjective、Variable、Model、Constraintを扱うversioned ontology foundation
- 判断問題のsnapshot、下位DAG composition、problem candidateの選択、evaluation、learning adoption
- resource reservation、execution authority、durable wait、historical judgment viewと既存記録adapter
- Company OSの目的・世界モデル・判断・評価を一周する匿名ホテルfixture

- `brainbase web:serve`で、今日、目的と現状、プロジェクトと関係者、情報と関係を1つのローカルWebホストに載せる
- 手元のGraphを理由と履歴つきで訂正する処理と、変更されないGraphの版の読み取り
- 判断価値記録の一覧、本人の評価と直すこと、引き継いだ経験・根拠の層、判断の種類ごとの委任の地図
- 根拠を保ったまま知識の検索を続ける処理（knowledge continuation / knowledge lookup）
- Foundation草案をGraphへ渡す共通の書込契約と履歴SQL
- 組織版と共用するUI部品、見た目の定義、別のホストが操作だけを足せる拡張点
- 組織へ送ったGraphの束の一覧（`brainbase graph:bundles`）と、手元の記憶を選んで登録し直す操作（`brainbase memory:list`、`brainbase memory:register`）
- Graphの束の検証・検索に使う関係IDと埋め込みの生成の公開subpath（`canonical-graph`、`embedding-provider`）

- Mana委任UI（`ui/outcome-mana`、`ui/icons/mana`）と公開subpath（`./ui/outcome-mana`、`./ui/outcome-mana.css`、`./ui/icons/*`）を共通UIから外した。Unsonの実行基盤（Mana）に結びつくため、組織版の画面として組織版が持つ。0.8.0の公開subpathのうちこの3件を削除する互換を壊す変更なので、0.8.0からのminorにした。そのほかの0.8.0公開subpathは削除・変更していない

- プロジェクトの目的・対象・用語・関係者・タスク・判断・根拠をまとめる共通UI
- Sigma.jsによる2Dグラフと、記録の詳細・関係・出典をたどる表示
- 欠落・取得失敗・確認済みの空を区別する表示契約
- 保存された判断を、使われた参照・行った判断・実行・結果の履歴として読み返せる判断履歴UI。期間と検索で絞り込み、取得できた範囲と未接続・取得失敗・確認済みの空を区別して表示する

ここで示す公開確認はnpm packageとGitHub Releaseの配布状態を対象にします。公開manualのCloudflare Pages配信、Organization / Manaの本番接続、実案件での継続利用は、それぞれ別の確認対象です。

## Candidate — v0.17.0（npm公開前）

プロジェクト一覧・詳細にアイコンを表示し、PNG/JPEG/WebP画像の登録・変更・削除をできるようにします。組織版と共用する `@unson/brainbase-mcp/ui/project-icon` を公開します。未登録時は名前の頭文字を表示します。公開する部品と関数が増えるためminorの0.17.0にします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.16.0（npm公開前）

Personal Webが本人のトークンで組織のGraphを読み取る検証用の経路（C1）を外します。`web:serve` の `--organization-graph` と `--organization-web` は無くなり、渡すと案内つきで失敗します。Personal Webは手元のGraphだけを描き、組織のGraphは組織版で見ます。公開していた `openInMemoryGraph` や `readOrganizationJudgments` などの出口も無くなるので、版を0.16.0に上げます。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.7（npm公開前）

世界の建物・地面・街並みの作りを上げます。地面と海は繰り返しの絵柄をやめて縞を無くし、窓は壁だけに付け、事業の種類ごとに建物の形を作り込み、都市を街区に、道を歩道つきのアスファルトにし、夜は街灯の光だまりを出します。建物の形・高さ・明かりの意味は変えません。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.6（npm公開前）

世界を街の景色にします。都市の外側に陸・海・山並み、広場に噴水、道に並木と街灯を描き、空は時刻に合わせて変わります（固定もできます）。完了した案件は記念の公園になり、前回開いてから動いた都市と広場の建物に光の印が出ます。景色はデータを表しません。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.5（npm公開前）

世界の都市の読み方を分けます。都市の広さは進行中の案件の数、目印の建物の高さと窓の明かりは最近30日の動き（その事業の決定と、置かれた判断）で決めます。完了・終了した案件は更地のまま残し、広さには数えません。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.4（npm公開前）

世界の画面で、案件が1〜3件の事業を描くときに区画の置き場が無く、描画が止まってそれ以降の事業も描かれなかった不具合を直します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.3（npm公開前）

世界の画面を、組織版でも同じ部品のまま載せられるようにします。組織のGraph APIが返すプロジェクトと用語の記録から世界を描く純関数を `@unson/brainbase-mcp/world` に公開し、画面にはプロジェクトを開く行き先をホストが渡せる口と、判断の記録が未接続であることの表示を加えます。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.2（npm公開前）

Canonical Taskの共通CRUDに、ホストのpolicyが指定する保存scopeを加えます。読み取り・変更・競合の読み戻し・操作の再実行・監査まで同じscopeを渡し、別scopeの結果の再利用を拒否します。組織の認証とDBの分離predicateはホストが持ち、scopeを指定しないローカル利用の契約は維持します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.1（npm公開前）

知識取得の継続（`@unson/brainbase-mcp/knowledge-continuation`）で、質問を初回の有効な計画で固定し、試行をモデルが付けた `attempt_id` で識別するように直します。目的ベースのlookup（`@unson/brainbase-mcp/knowledge-lookup`）のfinish応答は、根拠を挙げていない必須欄だけを `missing_fields` に示します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.0（npm公開前）

Foundationの草案を採用するMCPのtool `foundation_adopt`（`@unson/brainbase-mcp/foundation-authenticated-tools`）を加えます。採用者が `foundation_read` で確かめた版とdigestを渡し、正本APIの採用の経路を呼びます。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.14.0（npm公開前）

Foundationの草案を、判断と評価に使える版にする「採用」の書き込みの検査（`validateFoundationGraphAdoption`・`normalizeFoundationGraphAdoption`、`@unson/brainbase-mcp/foundation-graph-write`）を加えます。採用者が確かめた版と中身のまま次の版を作り、実行への使用は含めません。誰が採用できるかの照合はホストが行います。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.13.0（npm公開前）

予約と実行開始が照合する問題のスナップショットを、HTTPで作って読み戻す入口（`@unson/brainbase-mcp/judgment-problem-snapshot-http`）を加えます。保存・照合・読み取り方針は既存の処理のままで、主体と参照の照合（Foundationなど）はホストが渡します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.12.0（npm公開前）

個人KG v1から組織へ共有した記憶を、本人が撤回したときの取消を共通昇格処理（`@unson/brainbase-mcp/knowledge-promotion`）に加えます。審査待ちの申請は「取消済み」になって承認できなくなり、既に組織のGraphに入った事実は撤回済み・検索対象外になります。承認の記録と系譜は残します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.11.0（npm公開前）

組織の実行hostが、外部作用を自分で持たずに実行を登録できるようにします。登録は検査・予約の開始印・許可の発行までで、外部作用の結果は作用を持つ側が報告します。実行の帰属（本人・代行サービス・委任）を記録し、保存先を差し替えられます。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.10.15（npm公開前）

判断の枠組みのMCPツール（`brainbase_judgment_frame_catalog`・`brainbase_judgment_frame_record`）の定義と処理を `@unson/brainbase-mcp/judgment-frame` に加えます。呼び出し側はGraphの記録の読み方だけを差し込みます。読み取りの失敗や上限いっぱいの応答では、短い一覧を返さず失敗にします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Develop — release前

`develop`には存在するが、v0.10.0の公開範囲に含めていない範囲です。公開サイトの説明更新はpackageの機能追加とは別に配信されます。

- 密集したグラフのラベル重なりを抑制し、近傍を複数の輪に分散
- 関係探索で取得した別プロジェクトの記録を概要へ混入させない
- このページを含む公開サイトの現行化と、公開OSS版・組織版・未完成範囲の表示整理

`develop`にあることは、npmへ公開済み、production ready、組織導入可能という意味ではありません。

## Planned — 未実装または未完成

- outcomeとevaluationを実運用データへ継続接続する運用
- human / agent / committee runnerの運用契約
- authority graphとapproval workflow
- Personal → Project → Organizationのscope promotion
- マルチユーザー、RBAC、監査保持、managed connector、hosted runtime、HA
- 実案件での継続利用とexpert escalation削減の計測

計画文書やacceptance criteriaがあることは、実装や実証の完了を意味しません。

## 現在の製品境界

### OSS Brainbase

- 判断nodeとedgeの意味モデル
- ローカルSSOTとMCP
- 依存関係の検証
- ローカル実行runtime
- version、artifact、replay、evaluationへ進むための共通契約
- personal / project / organization scope primitive

### Organization / Enterprise

同じ判断モデルへ、次の運用機能を追加します。

- 組織identityとdirectory integration
- RBACとauthority graph
- 承認・例外・escalation
- multi-user concurrency
- managed connector
- auditとretention
- hosted runtimeとHA
- cross-project governance

組織版は別の脳を作るのではなく、共通のJudgment DAGへ組織運用上の制約を追加します。

## 公開内容の更新経路

```text
Brainbase GraphのPhilosophy / Decision
        ↓ snapshot hash付きcandidate
人間の承認
        ↓
GitHub PR
        ↓ docs check / build / smoke
merge to develop
        ↓
Cloudflare Pages deploy
        ↓
公開URL readback
```

Graphを直接Webへ表示しません。未承認情報や誤ったcandidateが公開されないよう、PRとCIを必須にします。

詳しい契約は[公開説明の昇格](/reference/cloudflare-pages#brainbase-graphから公開説明を昇格する)を参照してください。
