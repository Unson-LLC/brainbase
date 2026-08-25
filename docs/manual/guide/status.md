# 現在の状態

このページは、Brainbaseの思想、公開release、`develop`、将来計画を混同しないための境界表です。

配信中の正確なcommitは、各ページ下部の`Build <SHA>`で確認できます。

## Released — v0.4.0

npm packageとGitHub Releaseとして公開済みの範囲です。

- ローカル優先のPersonal Onboarding Kit
- MCPによる`get_context`、`search`、`resolve_entity`などの文脈参照
- Graph v2とRelation Registry
- Ontology 2.0.0と履歴versionの解釈
- Evidence Receipt
- Judgment systemとしてのCore Philosophy
- Judgment DAGのarchitectureとroadmap
- typed DAG contractとpreflight validation
- npm consumer smokeと公開契約digest

公開releaseのversion、`gitHead`、integrity、dist-tag、fresh install、GitHub Releaseを照合して公開完了を判断します。

## Develop — release前

`develop`には存在するが、v0.4.0へは含まれていない範囲です。

- `executeJudgmentDAG`によるローカル決定論的runner
- runner登録の事前検証
- nodeごとの直接依存output
- JSON-compatibleでdeep-frozenなrun record
- R1ローカル不変artifact storeのplanning contract
- 公開説明のP0〜P2同期、CI、Cloudflare Pages自動deploy、Graph candidateからPRを作る昇格経路

`develop`にあることは、npmへ公開済み、production ready、組織導入可能という意味ではありません。

## Planned — 未実装または未完成

- 不変run artifactの永続store実装
- 過去runのreplay
- outcomeとevaluationの本格実装
- human / agent / committee runnerの運用契約
- authority graphとapproval workflow
- Personal → Project → Organizationのscope promotion
- マルチユーザー、RBAC、監査保持、managed connector、hosted runtime、HA
- Brainbase Deploymentでの実案件dogfoodとexpert escalation削減の計測

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
