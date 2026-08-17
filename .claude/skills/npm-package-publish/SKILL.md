---
name: npm-package-publish
description: npmパッケージの公開、公開準備、公開監視、dist-tagやGitHub Releaseの復旧、公開済みversionの利用可能性確認に使う共通Skill。製品固有のpackage名、branch、workflow、検証コマンドは製品別adapterから受け取る。
---

# npm Package Publish

## Purpose

npm公開を、準備、検証、マージ、公開、外部照合、復旧に分けて安全に完了する。PRやCIの成功だけを公開完了とせず、同一commitに結び付いたregistry、Git tag、GitHub Release、fresh installの証拠で判定する。

## When to Use

npm packageの公開、公開準備、公開監視、dist-tag/GitHub Releaseの照合や復旧、fresh installによる利用可能性証明に使う。製品固有adapterがある場合は必ず併用する。

## Required Adapter

実行前に製品別adapterを読み、次の値を確定する。adapterがない、値が欠ける、または対象repositoryの現行ルールと矛盾する場合は公開操作を止める。

| Key | Meaning |
|---|---|
| `repository` | `owner/repo` |
| `package` | npm package名 |
| `default_branch` | 公開元branch |
| `version_source` | versionの正本 |
| `release_workflow` | merge後に監視するworkflow |
| `release_plan` | dist-tag、prerelease、Latest分類の正本コマンド |
| `targeted_checks` | release固有テスト、型検査、pack検査 |
| `fresh_install_check` | registryから新規導入して利用可能性を確認するコマンド |
| `product_convergence` | docs、runtime identityなど製品固有の追加照合 |

adapterは製品固有値だけを持つ。このSkillの共通手順を複製しない。

## Authority Boundary

- npm publish、dist-tag変更、GitHub Release変更、mergeは外部状態を変える。ユーザーが公開またはマージまで明示した範囲だけ実行する。
- 「公開準備」「release PR」はPR作成までであり、mergeや公開の許可ではない。
- versionを推測しない。承認済み要件、version正本、registryの既存versionを照合する。
- secret値を表示しない。secret名の存在、認証結果、権限範囲だけを扱う。
- repositoryの`AGENTS.md`とadapterが矛盾する場合は`AGENTS.md`を優先し、adapterの更新を必要事項として報告する。

## Required Workflow

### 1. 正本と実行環境を固定する

対象repo、remote、default branch、HEAD、dirty状態、versionを確認する。dirty treeは分類して保全し、公開作業は最新default branchから独立worktreeで行う。

`npm whoami`、GitHub認証、現在のdist-tagsを公開前に確認する。認証失敗、timeout、空応答は`未確認`であり、成功や0件にしない。

### 2. immutableな公開単位を作る

- registryに存在しない新しいversionを使う。公開済みversionを再利用しない。
- release PRはversion、lockfile、release note、必要なcatalogだけに限定する。runtime修正やworkflow修正を同乗させない。
- `npm pack --dry-run`または同等のpack検査でsecret、内部監査物、不要ファイルの混入を防ぐ。
- 一つのfocused commitへ対象ファイルだけを明示stageする。

### 3. current headを検証する

adapterの`targeted_checks`を先に実行する。source変更を含む、またはexact SHAへ結び付いた全体証拠がない場合はrepositoryのfull testも実行する。

CIはPR headとcheck suiteのSHAが一致した場合だけ証拠に使う。package対象ファイルが変わったら古いCIやreviewを再利用しない。

### 4. mergeと公開workflowを追跡する

repositoryの現行GitルールでPRを作成・mergeする。merge SHAを記録し、adapterの`release_workflow`がそのSHAを対象にしていることを確認する。

workflow全体の成否だけでなく、少なくとも次を段階別に記録する。

- package publish
- dist-tag収束
- Git tag / GitHub Release収束
- docsや追加projection

後段だけが失敗した場合、公開済みversionを未公開へ戻さず`published_but_<stage>_failed`として扱う。

### 5. 公開面を同じcommitへ収束させる

次をすべて照合するまで「公開完了」と言わない。

- npmの`version`と`gitHead`
- adapterの`release_plan`が要求するdist-tag
- Git tagのcommit
- GitHub Releaseのtarget、prerelease、Latest分類
- adapterの`fresh_install_check`
- adapterの`product_convergence`

fresh installは既存node_modulesやcheckoutを使わず、`mktemp -d`などの隔離先へregistryから導入する。

### 6. 時間と証拠を分離する

merge時刻、registry反映時刻、workflow完了時刻を記録する。pre-merge validation、merge-to-npm、post-publishを混ぜない。速度改善は同じ開始・完了条件のbefore/afterだけで主張する。

## Exact-SHA Evidence Reuse

| Condition | Decision |
|---|---|
| PR head、必須CI、公開sourceが同一SHAで成功 | repositoryが機械検証するfast path候補 |
| CI欠落、失敗、pending、head不一致、古い証拠 | full validationへfallback |
| merge後にpackage対象が変化 | full validationへfallback |
| source、runtime、manifestがuntrustedまたは不明 | 公開停止 |

人間やagentの「同じはず」という判断だけで検証stepを省略しない。

## Recovery

- publish前の失敗: 修正commitを作り、current headのCIとreviewを取り直す。
- publish済み・dist-tag不一致: 再publishせず、release planを確認してdist-tagだけを収束させる。
- publish済み・GitHub Release不一致: tag SHAを確認し、metadataだけを収束させる。tagを安易に削除しない。
- publish済み・docs失敗: versionを保持し、docs projectionだけを再実行する。
- 誤version: 通常rollbackに`npm unpublish`を使わず、影響確認後にdeprecateとdist-tag復元を優先する。
- timeoutや外部API障害: read-onlyで状態を再取得し、`未確認`、`失敗`、`部分完了`を分ける。

## Completion Report

最終報告にはversion、release SHA、workflow run、npm URL、GitHub Release URL、fresh install結果、未確認または部分失敗の段階を含める。次のどれか一つでも欠けたら、公開完了ではなく現在の部分状態を報告する。

## Red Flags

- PR mergeまたはworkflow greenだけで公開完了としている。
- PR head、merge SHA、npm `gitHead`、Git tagが一致しない。
- fresh installをcheckout内の既存依存で代用している。
- npm公開後のdocs失敗に対して同じversionを再publishしようとしている。
- secret値をログや回答へ出している。
- adapter未読のままpackage名、branch、dist-tagを推測している。

## Common Rationalizations

- 「CIがgreenだから公開済み」: registryとfresh installは別の外部状態である。
- 「adapterなしでもpackage.jsonから推測できる」: workflow、branch、追加収束条件はpackage.jsonだけでは確定しない。
- 「後段だけの失敗なら成功でよい」: package利用可否とworkflow全体の収束状態を分けて報告する。

## Verification

Skill変更時はfrontmatter/構造validatorと`git diff --check`を実行する。adapter変更時は必須key、共通Skill参照、製品固有コマンドの存在を検証する。実際の公開では上記の外部照合を省略しない。
