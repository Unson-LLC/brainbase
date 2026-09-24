# 現在の状態

このページは、Brainbaseの思想、公開release、`develop`、将来計画を混同しないための境界表です。

配信中の正確なcommitは、各ページ下部の`Build <SHA>`で確認できます。

## Released — v0.6.0

0.6.0までのnpm packageとGitHub Releaseで公開済みのOSS範囲です。

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
- OSSとOrganizationで共用するoutcome knowledge / Mana UIとicon assets
- Organization版が共通UIを再実装せず、OSS packageから利用するための公開subpath

## Candidate — v0.7.0（npm公開前）

`package.json`の0.7.0は配布候補のversionです。npm registry、dist-tag、`gitHead`、integrity、fresh install、GitHub Releaseのreadbackが完了するまで、公開済みのversionとして扱いません。

- Company OSのObjective、Variable、Model、Constraintを扱うversioned ontology foundation
- 判断問題のsnapshot、下位DAG composition、problem candidateの選択、evaluation、learning adoption
- resource reservation、execution authority、durable wait、historical judgment viewと既存記録adapter
- Company OSの目的・世界モデル・判断・評価を一周する匿名ホテルfixture

## Develop — release前

`develop`には存在するが、v0.7.0の公開候補にもまだ含めていない範囲です。公開サイトの説明更新はpackageの機能追加とは別に配信されます。

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
