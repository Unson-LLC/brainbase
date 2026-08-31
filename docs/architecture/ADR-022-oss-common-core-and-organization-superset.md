---
adr_id: ADR-022
title: OSS共通コアと組織版上位互換のリポジトリ・依存境界
status: accepted
date: 2026-08-18
related_stories:
  - story-brainbase-oss-superset-inventory
  - story-j0-organization-pinned-artifact-consumer
related_docs:
  - docs/management/stories/active/story-j0-organization-pinned-artifact-consumer.md
source_lineage: https://github.com/Unson-LLC/brainbase-unson/commit/747ba33eb42b478ffa7d2d6285dfd63f58c4a35f
supersedes: []
superseded_by: []
---

# ADR-022: OSS共通コアと組織版上位互換のリポジトリ・依存境界

## 文脈

`Unson-LLC/brainbase`と`Unson-LLC/brainbase-unson`は独立して発展し、現在の組織版はOSSのpackage、23 CLI command、5つのMCP tool、ローカル永続化・設定契約を包含していない。一方、組織版にはGraph SSOT、認証、Judgment Resolver、組織routine、管理UIなど、公開OSSへ移してはいけない組織固有の実装がある。

共通コアの置き場所を決めないまま個別機能を相互移植すると、二重実装が再発し、依存方向と公開責任が曖昧になる。

## 決定

### 1. OSSリポジトリを共通コアの正本にする

共通コアは第三のリポジトリへ分離せず、`Unson-LLC/brainbase`で開発・公開する`@unson/brainbase-mcp` packageを正本とする。純粋なドメイン処理、公開型、MCP/CLI契約、ローカルadapter、consumer向け回帰fixtureをここに置く。

`brainbase-unson`は固定versionまたは固定commitの共通コアを依存として取り込み、組織向けadapterと拡張を追加する。依存方向は常に次とする。

```text
brainbase-unson ──depends on──> @unson/brainbase-mcp
@unson/brainbase-mcp ──must not depend on──> brainbase-unson
```

組織版だけで先行したportableな処理は、先にOSSへupstreamし、公開契約と回帰テストを確定してから組織版で利用する。組織版からOSS sourceをコピーして長期保有しない。

### 2. 共通コアと組織拡張をportで分離する

共通コアはstorage、auth、transportを直接選ばず、明示的なportを公開する。初期対象はOntology、entity resolution、Onboarding、Judgment、設定・永続化である。

| 境界 | OSSの標準adapter | 組織版adapter |
|---|---|---|
| 永続化 | ローカルfile | Graph API / PostgreSQL |
| 認証 | ローカル利用者 | 組織principal / token |
| transport | stdio MCP / CLI | 組織MCP / HTTP / routine |
| 設定 | 環境変数・ローカルpath | 組織config・secret projection |

Graphの実データ、組織token、顧客情報、社内routine、管理UI、Judgment Resolver Hostは`brainbase-unson`に残す。OSSはこれらの実装や秘密を参照しない。

### 3. 上位互換を公開契約で判定する

「内部に似た機能がある」ことを上位互換とは扱わない。各組織版releaseは、対応するOSS versionについて次を満たした場合だけ上位互換を名乗れる。

- OSS packageを依存または再公開している
- OSSのMCP tool名・入力schema・結果schema・失敗意味を維持する
- OSSのCLI commandを同じ入口で利用できる
- ローカルadapterを必要とするOSS利用を破壊しない
- OSS consumer smokeとCLI/MCP contract testが組織版CIで通る

組織版の追加fieldやtoolは許可するが、OSS契約の削除・意味変更は許可しない。互換性を確認できないversionは`unverified`とし、上位互換として公開しない。

### 4. 段階移行する

移行順は次に固定する。

1. OSSの15 MCP tool、23 CLI command、package/binを契約fixtureにする
2. 共通portと純粋処理をOSS packageへ収束する
3. 組織版のGraph、認証、transport adapterを実装する
4. 欠落する5 MCP toolと23 CLI commandの互換入口を追加する
5. 組織版CIへOSS consumer互換Gateを追加する
6. Gate通過後にだけ二重実装を廃止する

各段階で既存runtimeを切り替える前に同一fixtureを旧実装と新実装へ適用する。挙動同等性が未確認のまま旧実装を削除しない。

## 採用しない案

- **第三の共通コアリポジトリを新設する**: 配布・version・変更責任が一つ増え、OSS自体が共通コアであるという利用者モデルを崩すため採用しない。
- **組織版を正本にしてOSSへ同期する**: 組織固有依存や秘密境界が公開側へ流出しやすく、OSSが組織版releaseに従属するため採用しない。
- **両リポジトリへ同じ実装をコピーする**: 修正とsecurity patchが分岐し、上位互換を継続的に証明できないため採用しない。
- **先にstorageを統合する**: Ontology、Onboarding、Judgmentの意味契約が未固定のため、データ破壊と権限混線の危険がある。

## 結果

- OSS利用者にとっての公開契約と、組織版が守る互換基準が一つになる。
- 組織版はOSSを包含しながら、Graph・認証・運用機能を独立して拡張できる。
- 最初の実装Storyは公開契約fixture化であり、本ADRだけでは現在の組織版を上位互換と認定しない。
- 共通コアの破壊的変更はOSSのversion契約として扱い、組織版で暗黙に吸収しない。

## 検証

棚卸し検証は本ADRの存在、採用した依存方向、15 MCP tool、23 CLI command、欠落5 tool、6段階の移行順を確認する。後続Storyでは実際のpackage dependencyとconsumer contract CIを追加し、文書だけの適合から実行可能な適合へ移行する。
