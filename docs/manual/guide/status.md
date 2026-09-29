# 現在の状態

このページは、Brainbaseの思想、公開release、`develop`、将来計画を混同しないための境界表です。

配信中の正確なcommitは、各ページ下部の`Build <SHA>`で確認できます。

## Released — v0.10.0

0.10.0までのnpm packageとGitHub Releaseで公開済みのOSS範囲です。

公開確認済みの配布証跡は次のとおりです。

- npm package [`@unson/brainbase-mcp@0.10.0`](https://www.npmjs.com/package/@unson/brainbase-mcp/v/0.10.0)
- npmの`latest`は`0.10.0`を指し、registryの`gitHead`は`56a13a2c780fb0390c804bddfb55f00c2d5a06ed`
- GitHub Release [`v0.10.0`](https://github.com/Unson-LLC/brainbase/releases/tag/v0.10.0)
- 公開workflowの検証済みrun [`36442188359` attempt 2](https://github.com/Unson-LLC/brainbase/actions/runs/36442188359/attempts/2)

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

ここで示す公開確認はnpm packageとGitHub Releaseの配布状態を対象にします。公開manualのCloudflare Pages配信、Organization / Manaの本番接続、実案件での継続利用は、それぞれ別の確認対象です。

## Candidate — v0.10.8（npm公開前）

プロジェクト概要で取消済み・完了済みの仕事を「今日」の対象から除外し、総数が未取得の場合は表示中の件数を区別します。プロジェクト画面の配色、見出し、指標、一覧を共通デザインに合わせます。npm配布と外部照合が完了するまでは公開済みとして扱いません。

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
